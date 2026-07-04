import * as migration_20260704_101518_migration from './20260704_101518_migration';

export const migrations = [
  {
    up: migration_20260704_101518_migration.up,
    down: migration_20260704_101518_migration.down,
    name: '20260704_101518_migration'
  },
];
