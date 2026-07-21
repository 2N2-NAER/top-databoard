create table if not exists dashboard_state_revisions (
  id bigserial primary key,
  version bigint not null unique,
  base_version bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists dashboard_state_revisions_version_desc_idx
  on dashboard_state_revisions (version desc);
