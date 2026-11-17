"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailPlus, Trash2, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RelativeTime } from "@/components/ui/relative-time";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { Table, TableContainer, Td, Th, Tr } from "@/components/ui/table";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { OrgRole } from "@/shared/enums";
import { assignableRoles, canManageRole, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/shared/permissions";
import type { CreatedInvitationDto, InvitationDto, MemberDto } from "@/shared/types";

export function MembersSettings() {
  const org = useOrg();
  const queryClient = useQueryClient();
  const canManage = org.can("member:manage");
  const members = useOrgQuery<MemberDto[]>(["members"], "/members");
  const invitations = useOrgQuery<InvitationDto[]>(["invitations"], "/invitations", undefined, { enabled: canManage });
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>(OrgRole.MEMBER);
  const [created, setCreated] = useState<CreatedInvitationDto | null>(null);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "members") }); void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "invitations") }); };
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const invite = useMutation({ mutationFn: () => api.post<CreatedInvitationDto>(`${org.api}/invitations`, { email, role }), onSuccess: (result) => { setCreated(result); setEmail(""); refresh(); } });
  const changeRole = useMutation({ mutationFn: (input: { id: string; role: OrgRole }) => api.patch(`${org.api}/members/${input.id}`, { role: input.role }), onSuccess: () => { toast.success("Role updated"); refresh(); }, onError });
  const remove = useMutation({
    mutationFn: (member: MemberDto) => api.delete(`${org.api}/members/${member.id}`),
    onSuccess: (_result, member) => {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload: this workspace is no longer accessible
      if (member.isYou) window.location.assign("/org");
      else { toast.success(`${member.name} removed`); setRemoving(null); refresh(); } },
    onError,
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`${org.api}/invitations/${id}`), onSuccess: () => { toast.success("Invitation revoked"); refresh(); }, onError });
  const inviteFields = invite.error instanceof ApiError ? invite.error.fields : {};
  const grantable = assignableRoles(org.role).filter((value) => value !== OrgRole.OWNER);

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-hidden">
        <CardHeader>
          <div><CardTitle>Members</CardTitle><p className="mt-0.5 text-sm text-muted">Everyone with access to this organization.</p></div>
          {canManage && <Button variant="primary" onClick={() => { setCreated(null); invite.reset(); setInviting(true); }}><MailPlus />Invite member</Button>}
        </CardHeader>
        {members.isPending ? <div className="p-5"><Skeleton className="h-32" /></div> : members.isError ? <ErrorState onRetry={() => members.refetch()} /> : (
          <TableContainer>
            <Table>
              <thead><tr><Th>Member</Th><Th>Role</Th><Th className="hidden sm:table-cell">Joined</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {members.data.map((member) => {
                  const manageable = canManage && !member.isYou && canManageRole(org.role, member.role);
                  return (
                    <Tr key={member.id}>
                      <Td><span className="flex items-center gap-3"><Avatar name={member.name} size="lg" className="size-8 text-xs" /><span className="min-w-0"><span className="flex items-center gap-2 font-medium">{member.name}{member.isYou && <Badge>You</Badge>}</span><span className="block truncate text-xs text-muted">{member.email}</span></span></span></Td>
                      <Td>
                        {manageable ? (
                          <Select value={member.role} onValueChange={(value) => changeRole.mutate({ id: member.id, role: value as OrgRole })}>
                            <SelectTrigger className="w-32" aria-label={`Role for ${member.name}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{assignableRoles(org.role).map((value) => <SelectItem key={value} value={value}>{ROLE_LABELS[value]}</SelectItem>)}</SelectContent>
                          </Select>
                        ) : <Badge tone={member.role === "OWNER" ? "brand" : "neutral"}>{ROLE_LABELS[member.role]}</Badge>}
                      </Td>
                      <Td className="hidden text-text-2 sm:table-cell"><RelativeTime date={member.joinedAt} /></Td>
                      <Td className="text-right">
                        {member.isYou ? <Button size="sm" variant="ghost" onClick={() => setRemoving(member)}><UserMinus />Leave</Button>
                          : manageable ? <Button size="icon-sm" variant="danger-ghost" aria-label={`Remove ${member.name}`} onClick={() => setRemoving(member)}><Trash2 /></Button> : null}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableContainer>
        )}
      </Card>

      {canManage && (invitations.data?.length ?? 0) > 0 && (
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Pending invitations</CardTitle></CardHeader>
          <TableContainer>
            <Table>
              <thead><tr><Th>Email</Th><Th>Role</Th><Th className="hidden sm:table-cell">Expires</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {invitations.data!.map((invitation) => (
                  <Tr key={invitation.id}>
                    <Td className="h-11">{invitation.email}</Td><Td className="h-11">{ROLE_LABELS[invitation.role]}</Td>
                    <Td className="hidden h-11 text-text-2 sm:table-cell">{invitation.expired ? <Badge tone="warn">Expired</Badge> : <RelativeTime date={invitation.expiresAt} />}</Td>
                    <Td className="h-11 text-right"><Button size="sm" variant="ghost" onClick={() => revoke.mutate(invitation.id)}>Revoke</Button></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableContainer>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>What each role can do</CardTitle></CardHeader>
        <dl className="grid gap-x-8 gap-y-3 px-5 pb-5 sm:grid-cols-2">
          {(Object.keys(ROLE_LABELS) as OrgRole[]).map((value) => <div key={value}><dt className="text-sm font-medium">{ROLE_LABELS[value]}</dt><dd className="text-sm text-muted">{ROLE_DESCRIPTIONS[value]}</dd></div>)}
        </dl>
      </Card>

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          {created ? (
            <>
              <DialogHeader><DialogTitle>Invitation ready</DialogTitle><DialogDescription>Send this link to {created.email}. It works once, for that address only, and expires in 7 days. It is shown only now.</DialogDescription></DialogHeader>
              <DialogBody><div className="flex gap-2"><Input readOnly value={created.inviteUrl} className="font-mono text-xs" onFocus={(event) => event.target.select()} aria-label="Invitation link" /><CopyButton value={created.inviteUrl} variant="primary" /></div></DialogBody>
              <DialogFooter><Button onClick={() => setInviting(false)}>Done</Button></DialogFooter>
            </>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); invite.mutate(); }}>
              <DialogHeader><DialogTitle>Invite a member</DialogTitle><DialogDescription>You will get a single-use link to share with them.</DialogDescription></DialogHeader>
              <DialogBody className="flex flex-col gap-4">
                <Field label="Email" error={inviteFields.email?.[0]}><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" autoFocus /></Field>
                <Field label="Role" hint={ROLE_DESCRIPTIONS[role]}>
                  <Select value={role} onValueChange={(value) => setRole(value as OrgRole)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{grantable.map((value) => <SelectItem key={value} value={value}>{ROLE_LABELS[value]}</SelectItem>)}</SelectContent></Select>
                </Field>
                {invite.error && Object.keys(inviteFields).length === 0 && <p role="alert" className="text-sm text-danger-fg">{errorMessage(invite.error)}</p>}
              </DialogBody>
              <DialogFooter><Button onClick={() => setInviting(false)}>Cancel</Button><Button type="submit" variant="primary" loading={invite.isPending} disabled={!email.includes("@")}>Create invitation</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)} destructive loading={remove.isPending}
        title={removing?.isYou ? `Leave ${org.organization.name}?` : `Remove ${removing?.name ?? "member"}?`} confirmLabel={removing?.isYou ? "Leave organization" : "Remove member"}
        description={removing?.isYou ? "You will lose access immediately and need a new invitation to return." : "They lose access immediately. Incidents assigned to them become unassigned."}
        onConfirm={() => removing && remove.mutate(removing)} />
    </div>
  );
}
