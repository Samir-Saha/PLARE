"use client";
import { useApp } from "@/components/shell";
import { LeadGm } from "@/components/gm/lead-gm";
import { MemberGm } from "@/components/gm/member-gm";

/** GM messages: leads and admins get the inbox; members send theirs. */
export default function Gm() {
  const { isLead } = useApp();
  return isLead ? <LeadGm /> : <MemberGm />;
}
