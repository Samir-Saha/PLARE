"use client";
import { useApp } from "@/components/shell";
import { LeadHome } from "@/components/home/lead-home";
import { MemberHome } from "@/components/home/member-home";

/** Home: leads and admins get the dashboard; members get their personal home. */
export default function Home() {
  const { isLead } = useApp();
  return isLead ? <LeadHome /> : <MemberHome />;
}
