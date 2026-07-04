import * as migration_20260704_101518_migration from './20260704_101518_migration';
import * as migration_20260704_121805_migration from './20260704_121805_migration';

export const migrations = [
  {
    up: migration_20260704_101518_migration.up,
    down: migration_20260704_101518_migration.down,
    name: '20260704_101518_migration',
  },
  {
    up: migration_20260704_121805_migration.up,
    down: migration_20260704_121805_migration.down,
    name: '20260704_121805_migration'
  },
];
