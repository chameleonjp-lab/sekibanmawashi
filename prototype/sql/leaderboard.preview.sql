-- 試作プレビュー用の順位表。本番の Supabase 共通表ではない。
-- 公式 PR5 ではこのファイルをそのまま使わない。

create table if not exists challenge_runs (
  id text primary key,
  pool_version text not null,
  client_instance_id text not null,
  player_tag text not null,
  puzzle_ids text not null,
  status text not null default 'prepared',
  created_at timestamptz not null default now()
);

create index if not exists challenge_runs_client_idx
  on challenge_runs (client_instance_id, status);

create table if not exists leaderboard_entries (
  id text primary key,
  pool_version text not null,
  player_tag text not null,
  total_time_ms integer not null,
  total_moves integer not null,
  puzzle_ids text not null,
  submitted_at timestamptz not null default now()
);

create index if not exists leaderboard_rank_idx
  on leaderboard_entries (pool_version, total_time_ms, total_moves, submitted_at);
