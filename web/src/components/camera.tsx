"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/components/ui";

export type Capture = { blob: Blob; token: string };

/** Longest side of the saved photo, in pixels. Keeps uploads well under the 8 MB limit. */
const MAX_SIDE = 1600;

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return "Camera access is blocked. Allow it in your browser's site settings, then press Open camera again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device. Open PLARE on your phone to take this photo.";
  if (name === "NotReadableError") return "Another app is using the camera. Close it, then press Open camera again.";
  return "The camera didn't start. Press Open camera to try again.";
}

/**
 * Takes a photo with the device camera inside the page. There is no file picker, so the photo
 * has to be taken now. The camera opens only when the person presses the button and turns off
 * as soon as the photo is taken or the form closes.
 *
 * `getToken` asks the server for a one-time capture token at the moment the photo is taken.
 */
export function CameraCapture({ getToken, onChange }: { getToken: () => Promise<string>; onChange: (c: Capture | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "live" | "taking" | "taken">("idle");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  // Turn the camera off and free the preview if the form closes.
  useEffect(() => () => stop(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function open() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      return setError("This browser can't open the camera. Open PLARE in Safari or Chrome on your phone.");
    }
    setPhase("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setPhase("live");
    } catch (e) {
      stop();
      setError(cameraError(e));
      setPhase("idle");
    }
  }

  async function take() {
    const v = video.current;
    if (!v || !v.videoWidth) return setError("The camera isn't ready yet. Wait a second and try again.");
    setPhase("taking");
    setError("");
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.88));
    if (!blob) {
      setError("Couldn't save the photo. Try again.");
      return setPhase("live");
    }
    try {
      const token = await getToken();
      stop();
      setPreview(URL.createObjectURL(blob));
      setPhase("taken");
      onChange({ blob, token });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the photo. Try again.");
      setPhase("live");
    }
  }

  function retake() {
    setPreview("");
    onChange(null);
    open();
  }

  const live = phase === "live" || phase === "taking" || phase === "starting";
  return (
    <div className="space-y-2.5">
      {/* Mirrored like a selfie camera. The saved photo isn't mirrored. */}
      <video ref={video} playsInline muted aria-label="Camera preview"
        className={`aspect-[3/4] max-h-96 w-full max-w-xs -scale-x-100 rounded-xl border border-line bg-raised object-cover ${live ? "" : "hidden"}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {phase === "taken" && preview && <img src={preview} alt="The photo you took" className="max-h-96 w-full max-w-xs rounded-xl border border-line object-cover" />}
      <div className="flex flex-wrap gap-2">
        {phase === "idle" && <Button type="button" onClick={open}>Open camera</Button>}
        {live && <Button type="button" variant="primary" busy={phase !== "live"} onClick={take}>Take photo</Button>}
        {live && <Button type="button" variant="ghost" onClick={() => { stop(); setPhase("idle"); }}>Close camera</Button>}
        {phase === "taken" && <Button type="button" variant="outline" onClick={retake}>Retake</Button>}
      </div>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
