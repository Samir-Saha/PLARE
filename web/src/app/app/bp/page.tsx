"use client";
import { fmtToday } from "@/lib/format";
import { useApp } from "@/components/shell";
import { Page, PageHeader } from "@/components/ui";
import { LeadBp } from "@/components/bp/lead-bp";
import { MemberBp } from "@/components/bp/member-bp";

export default function BpCheckIns() {
  const { me, isLead } = useApp();
  return (
    <Page>
      <PageHeader title="BP check-ins"
        hint={`${fmtToday(me.timezone)} · ${isLead ? "random photo check-ins in business professional" : "photos in business professional, at random times"}`} />
      {isLead ? <LeadBp /> : <MemberBp />}
    </Page>
  );
}
