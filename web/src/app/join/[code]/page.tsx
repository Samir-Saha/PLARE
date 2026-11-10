"use client";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError, post } from "@/lib/api";
import { signInWithGoogle, supabase } from "@/lib/supabase";
import { Button, Card, Notice, Skeleton, Wordmark } from "@/components/ui";

export default function JoinPage() {
  // The invite code is only known at request time, so this part streams in.
  return (
    <Suspense fallback={<main className="mx-auto max-w-md p-5"><Skeleton rows={1} /></main>}>
      <Join />
    </Suspense>
  );
}

function Join() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<{ org_name: string } | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ org_name: string }>(`/invites/${code}`).then(setInvite, (e) => {
      if (e instanceof ApiError && e.status === 401) setNeedsSignIn(true);
      else setError(e.message);
    });
  }, [code]);

  async function accept() {
    try {
      const r = await post<{ org_id: string }>(`/invites/${code}/accept`);
      localStorage.setItem("plare.org", r.org_id);
      router.replace("/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-items-center p-5">
      <Card className="w-full space-y-3">
        <Wordmark className="text-xl" />
        {error && <Notice>{error}</Notice>}
        {needsSignIn && (
          <>
            <p>Sign in to accept this invite.</p>
            {supabase ? <Button variant="primary" onClick={() => signInWithGoogle({ next: `/join/${code}` }).catch((e) => setError(e.message))}>Continue with Google</Button>
              : <p className="text-sm text-muted">Google sign-in isn&apos;t configured on this deployment yet.</p>}
          </>
        )}
        {invite && (
          <>
            <p>You&apos;ve been invited to <strong>{invite.org_name}</strong>.</p>
            <Button variant="primary" onClick={accept}>Join group</Button>
          </>
        )}
        {!invite && !needsSignIn && !error && <Skeleton rows={1} />}
      </Card>
    </main>
  );
}
