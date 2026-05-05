export type AdminUserStatus = 'active' | 'disabled';

export type AdminUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  status: AdminUserStatus;
  readonly activeSessions: number;
};

export function createUserStore(): AdminUser[] {
  return [
    {
      id: 'user_1',
      email: 'operator@example.com',
      name: 'Operator',
      status: 'active',
      activeSessions: 1,
    },
    {
      id: 'user_2',
      email: 'casey@example.com',
      name: 'Casey Customer',
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
}

export function cloneUsers(users: readonly AdminUser[]): readonly AdminUser[] {
  return users.map((user) => ({ ...user }));
}
