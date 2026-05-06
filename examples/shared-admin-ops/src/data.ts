export type AdminUserStatus = 'active' | 'disabled';

export type AdminUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  status: AdminUserStatus;
  readonly activeSessions: number;
};

const INITIAL_USERS: readonly AdminUser[] = [
  {
    id: 'user_1',
    email: 'alex@example.com',
    name: 'Alex Morgan',
    status: 'active',
    activeSessions: 1,
  },
  {
    id: 'user_2',
    email: 'casey@example.com',
    name: 'Casey Kim',
    status: 'active',
    activeSessions: 3,
  },
  {
    id: 'user_3',
    email: 'disabled@example.com',
    name: 'Disabled User',
    status: 'disabled',
    activeSessions: 0,
  },
];

export function createUserStore(): AdminUser[] {
  return INITIAL_USERS.map((user) => ({ ...user }));
}

export function cloneUsers(users: readonly AdminUser[]): AdminUser[] {
  return users.map((user) => ({ ...user }));
}
