-- Ahanu captain data (per-user). Offline copy lives in the client store;
-- these tables sync when a signed-in skipper is back in range.

create table if not exists ahanu_catches (
  id          text primary key,
  user_id     text not null,
  species     text not null,
  lat         double precision not null,
  lon         double precision not null,
  caught_at   timestamptz not null,
  length_in   double precision,
  weight_lb   double precision,
  released    boolean not null default false,
  notes       text,
  sst_c       double precision,
  depth_m     double precision,
  conditions  text,
  created_at  timestamptz not null default now()
);
create index if not exists ahanu_catches_user_idx on ahanu_catches (user_id);

create table if not exists ahanu_waypoints (
  id          text primary key,
  user_id     text not null,
  name        text not null,
  lat         double precision not null,
  lon         double precision not null,
  depth_m     double precision,
  notes       text,
  tags        text,
  created_at  timestamptz not null default now()
);
create index if not exists ahanu_waypoints_user_idx on ahanu_waypoints (user_id);

create table if not exists ahanu_float_plans (
  id          text primary key,
  user_id     text not null,
  payload     text not null,
  updated_at  timestamptz not null default now()
);
