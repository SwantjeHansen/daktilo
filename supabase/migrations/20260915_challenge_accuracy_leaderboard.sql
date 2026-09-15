-- Daktilo V14.4: category/speed-specific Challenge accuracy leaderboard.
-- Stores only aggregates; detailed per-word events remain private.

create table if not exists public.daktilo_challenge_accuracy (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  speed_ms integer not null check (speed_ms > 0),
  correct_first_try bigint not null default 0 check (correct_first_try >= 0),
  total_attempts bigint not null default 0 check (total_attempts >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, category, speed_ms)
);

alter table public.daktilo_challenge_accuracy enable row level security;
revoke all on table public.daktilo_challenge_accuracy from anon, authenticated;

create or replace function public.daktilo_update_challenge_accuracy_from_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event jsonb;
  v_user uuid;
  v_category text;
  v_speed integer;
  v_first_try_correct integer;
begin
  if tg_op = 'INSERT' then
    v_event := new.event;
    v_user := new.user_id;
  elsif tg_op = 'DELETE' then
    v_event := old.event;
    v_user := old.user_id;
  else
    return new;
  end if;

  if coalesce(v_event->>'mode', '') <> 'challenge'
     or coalesce(v_event->>'challengeType', '') <> 'points' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_category := coalesce(nullif(v_event->>'itemCategory', ''), nullif(v_event->>'category', ''));
  begin
    v_speed := nullif(v_event->>'speedMs', '')::integer;
  exception when others then
    v_speed := null;
  end;

  if v_category is null or v_speed is null or v_speed <= 0 then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if v_event ? 'firstTryCorrect' then
    v_first_try_correct := case when coalesce(v_event->>'firstTryCorrect', 'false') = 'true' then 1 else 0 end;
  else
    v_first_try_correct := case
      when coalesce(v_event->>'correct', 'false') = 'true'
       and coalesce(nullif(v_event->>'replays', '')::integer, 0) = 0
       and coalesce(v_event->>'skipped', 'false') <> 'true'
      then 1 else 0 end;
  end if;

  if tg_op = 'INSERT' then
    insert into public.daktilo_challenge_accuracy
      (user_id, category, speed_ms, correct_first_try, total_attempts, updated_at)
    values
      (v_user, v_category, v_speed, v_first_try_correct, 1, now())
    on conflict (user_id, category, speed_ms) do update
      set correct_first_try = public.daktilo_challenge_accuracy.correct_first_try + excluded.correct_first_try,
          total_attempts = public.daktilo_challenge_accuracy.total_attempts + 1,
          updated_at = now();
  else
    update public.daktilo_challenge_accuracy
      set correct_first_try = greatest(0, correct_first_try - v_first_try_correct),
          total_attempts = greatest(0, total_attempts - 1),
          updated_at = now()
      where user_id = v_user and category = v_category and speed_ms = v_speed;

    delete from public.daktilo_challenge_accuracy
      where user_id = v_user and category = v_category and speed_ms = v_speed and total_attempts <= 0;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists daktilo_challenge_accuracy_event_insert on public.daktilo_events;
create trigger daktilo_challenge_accuracy_event_insert
after insert on public.daktilo_events
for each row execute function public.daktilo_update_challenge_accuracy_from_event();

drop trigger if exists daktilo_challenge_accuracy_event_delete on public.daktilo_events;
create trigger daktilo_challenge_accuracy_event_delete
after delete on public.daktilo_events
for each row execute function public.daktilo_update_challenge_accuracy_from_event();

-- Backfill existing challenge events once.
insert into public.daktilo_challenge_accuracy
  (user_id, category, speed_ms, correct_first_try, total_attempts, updated_at)
select
  e.user_id,
  coalesce(nullif(e.event->>'itemCategory', ''), nullif(e.event->>'category', '')) as category,
  (e.event->>'speedMs')::integer as speed_ms,
  sum(
    case
      when case
        when e.event ? 'firstTryCorrect'
          then coalesce(e.event->>'firstTryCorrect', 'false') = 'true'
        else coalesce(e.event->>'correct', 'false') = 'true'
             and coalesce(nullif(e.event->>'replays', '')::integer, 0) = 0
             and coalesce(e.event->>'skipped', 'false') <> 'true'
      end
      then 1 else 0
    end
  )::bigint as correct_first_try,
  count(*)::bigint as total_attempts,
  now()
from public.daktilo_events e
where coalesce(e.event->>'mode', '') = 'challenge'
  and coalesce(e.event->>'challengeType', '') = 'points'
  and coalesce(nullif(e.event->>'itemCategory', ''), nullif(e.event->>'category', '')) is not null
  and (e.event->>'speedMs') ~ '^[0-9]+$'
group by e.user_id,
         coalesce(nullif(e.event->>'itemCategory', ''), nullif(e.event->>'category', '')),
         (e.event->>'speedMs')::integer
on conflict (user_id, category, speed_ms) do update
set correct_first_try = excluded.correct_first_try,
    total_attempts = excluded.total_attempts,
    updated_at = now();

create or replace function public.daktilo_challenge_accuracy_leaderboard(
  p_category text,
  p_speed_ms integer,
  p_min_attempts integer default 20,
  p_limit integer default 15
)
returns table (
  username text,
  correct_count bigint,
  total_count bigint,
  accuracy_percent numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.username,
    a.correct_first_try as correct_count,
    a.total_attempts as total_count,
    round((a.correct_first_try::numeric / nullif(a.total_attempts, 0)) * 100, 1) as accuracy_percent
  from public.daktilo_challenge_accuracy a
  join public.daktilo_profiles p on p.user_id = a.user_id
  where a.category = p_category
    and a.speed_ms = p_speed_ms
    and a.total_attempts >= greatest(1, p_min_attempts)
  order by accuracy_percent desc, a.total_attempts desc, p.username asc
  limit least(20, greatest(1, p_limit));
$$;

revoke all on function public.daktilo_challenge_accuracy_leaderboard(text, integer, integer, integer) from public;
grant execute on function public.daktilo_challenge_accuracy_leaderboard(text, integer, integer, integer) to anon, authenticated;
