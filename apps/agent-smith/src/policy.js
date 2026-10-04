import { frameworks } from './blueprint.js';
export function canReview(id, cfg) { return cfg.owners.includes(id) || cfg.approvers.includes(id); }
export function assertFramework(value) { if (!frameworks.includes(value)) throw new Error('Unknown framework'); }
export function assertAssignableRole(role) {
  if (!role?.editable) throw new Error('Bot role must be above the role it grants.');
  if (role.permissions?.bitfield !== 0n) throw new Error('Role has elevated permissions; run the permission audit before granting it.');
  return role;
}
export function maySelfJoin({ accepted, existing, requested }) {
  assertFramework(requested);
  if (!accepted) throw new Error('Accept the rules first with /accept.');
  if (existing.length) throw new Error('You already selected a framework. Use /request for additional access.');
  return true;
}
