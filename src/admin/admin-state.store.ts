import { Context } from 'telegraf';

export type AdminAction =
  | 'create_account'
  | 'add_balance'
  | 'subtract_balance'
  | 'check_account'
  | 'disable_account'
  | 'enable_account'
  | 'delete_account';

export interface AdminState {
  action: AdminAction;
  step: 'key' | 'pin' | 'balance' | 'amount';
  payload: {
    key?: string;
    pin?: string;
  };
}

const adminStates = new Map<number, AdminState>();

export function hasAdminState(ctx: Context): boolean {
  const userId = ctx.from?.id;

  return Boolean(userId && adminStates.has(userId));
}

export function getAdminState(ctx: Context): AdminState | undefined {
  const userId = ctx.from?.id;

  return userId ? adminStates.get(userId) : undefined;
}

export function setAdminState(userId: number, state: AdminState): void {
  adminStates.set(userId, state);
}

export function clearAdminState(ctx: Context): void {
  const userId = ctx.from?.id;

  if (userId) {
    adminStates.delete(userId);
  }
}
