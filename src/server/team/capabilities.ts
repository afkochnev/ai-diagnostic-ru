import {launchEnvironment} from '@/server-runtime/launch-gates';
export {teamCreationEnabled,teamInvitationsEnabled} from '@/server-runtime/launch-gates';
/** Production is OFF until its exact origin/project pair and explicit flag agree. */
export function teamFoundationEnabled() {
  return launchEnvironment('team');
}
