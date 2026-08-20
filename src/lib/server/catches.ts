import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { z } from "zod";

const catchInput = z.object({
  id: z.string(),
  species: z.string(),
  lat: z.number(),
  lon: z.number(),
  at: z.string(),
  lengthIn: z.number().optional(),
  weightLb: z.number().optional(),
  released: z.boolean(),
  notes: z.string().optional(),
  sstC: z.number().optional(),
  depthM: z.number().optional(),
  conditions: z.string().optional(),
});

export const listCatches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return sql<{
      id: string;
      species: string;
      lat: number;
      lon: number;
      caught_at: string;
      length_in: number | null;
      weight_lb: number | null;
      released: boolean;
      notes: string | null;
      sst_c: number | null;
      depth_m: number | null;
      conditions: string | null;
    }>`select id, species, lat, lon, caught_at, length_in, weight_lb, released, notes, sst_c, depth_m, conditions
       from ahanu_catches where user_id = ${context.userId} order by caught_at desc`;
  });

export const upsertCatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => catchInput.parse(input))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into ahanu_catches (id, user_id, species, lat, lon, caught_at, length_in, weight_lb, released, notes, sst_c, depth_m, conditions)
      values (
        ${data.id}, ${context.userId}, ${data.species}, ${data.lat}, ${data.lon}, ${data.at},
        ${data.lengthIn ?? null}, ${data.weightLb ?? null}, ${data.released}, ${data.notes ?? null},
        ${data.sstC ?? null}, ${data.depthM ?? null}, ${data.conditions ?? null}
      )
      on conflict (id) do update set
        species = excluded.species,
        notes = excluded.notes,
        released = excluded.released
    `;
    return { ok: true as const };
  });
