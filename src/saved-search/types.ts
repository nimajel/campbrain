import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SavedSearchScopeSchema = z.object({
  // Exactly one of region | parkPageIds drives park selection; both empty = all parks.
  // Validation: not both non-empty.
  region: z.enum(['north-coast', 'bay-area', 'sierra', 'central-coast', 'socal']).nullable(),
  parkPageIds: z.array(z.string()).default([]),
}).refine(
  (scope) => !(scope.region !== null && scope.parkPageIds.length > 0),
  { message: 'Specify region or parkPageIds, not both' }
);

export const SavedSearchDatePatternSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed_range'), from: isoDate, to: isoDate }),
  z.object({
    kind: z.literal('any_weekend'),
    horizonDays: z.number().int().positive().max(180).default(90),
  }),
]);

export const SavedSearchFiltersSchema = z.object({
  access: z.array(z.enum(['drive_in', 'hike_in', 'boat_in'])).default([]),
  kinds: z.array(z.enum(['tent', 'hookup', 'cabin'])).default([]),
  hide: z.array(z.enum(['group', 'equestrian', 'walk_up'])).default([]),
  minNights: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
});

export const SavedSearchSchema = z.object({
  id: z.string(),                       // uuid (crypto.randomUUID)
  userId: z.string().nullable(),        // null in single-user mode
  provider: z.enum(['california-parks', 'recreation-gov']).default('california-parks'),
  name: z.string().min(1),
  scope: SavedSearchScopeSchema,
  datePattern: SavedSearchDatePatternSchema,
  filters: SavedSearchFiltersSchema,
  alertEnabled: z.boolean().default(false),
  emailEnabled: z.boolean().default(true),
  createdAt: z.string(),                // ISO 8601
  updatedAt: z.string(),
  // Opaque blob preserved from legacy migration; inert in v1 scanner logic.
  legacy: z.unknown().optional(),
});

export const SavedSearchInputSchema = SavedSearchSchema.omit({ id: true, createdAt: true, updatedAt: true });

export type SavedSearch = z.infer<typeof SavedSearchSchema>;
export type SavedSearchScope = z.infer<typeof SavedSearchScopeSchema>;
export type SavedSearchDatePattern = z.infer<typeof SavedSearchDatePatternSchema>;
export type SavedSearchFilters = z.infer<typeof SavedSearchFiltersSchema>;
export type SavedSearchInput = z.infer<typeof SavedSearchInputSchema>;
