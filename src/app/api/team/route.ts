import { guarded, ok, fail } from '@/lib/route-utils';
import { addPerson, crewOptions, loadTeamFleet, truckOptions, updatePerson } from '@/lib/team';
import { TeamMemberSchema, TeamMemberUpdateSchema } from '@/lib/schema';

export const GET = guarded('read', async () => {
  const { people, trucks } = await loadTeamFleet();
  return ok({
    people,
    trucks,
    crewOptions: crewOptions(people),
    truckOptions: truckOptions(trucks),
  });
});

// Same capability as job edits: adding personnel is a structural roster
// change, gated to coordinator/admin like everything else that isn't a
// pure read.
export const POST = guarded('write', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = TeamMemberSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid team member payload.', 422, { issues: parsed.error.issues });
  }
  const person = await addPerson(parsed.data, { user: caller.user, source: caller.source });
  return ok({ person });
});

// Fills blanks on an existing person; refuses to overwrite a populated
// field — see updatePerson for why.
export const PATCH = guarded('write', async (req, caller) => {
  const body = await req.json().catch(() => null);
  const parsed = TeamMemberUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return fail('Invalid team member payload.', 422, { issues: parsed.error.issues });
  }
  const person = await updatePerson(parsed.data, { user: caller.user, source: caller.source });
  return ok({ person });
});
