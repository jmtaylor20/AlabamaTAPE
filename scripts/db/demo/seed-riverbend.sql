-- Demonstration data for Riverbend County (system 901), a fabricated system
-- that scripts/db/seed.mjs creates. Gives it declared programs, a place on the
-- current compliance list, two selected programs with reviewers, and a
-- released notification, so a Director account can walk the district side.
-- Everything here is invented. Remove it with teardown-riverbend.sql.
do $$
declare
  v_lea uuid; v_year uuid; v_cycle uuid; v_review uuid; v_draw uuid; v_hs uuid; v_ctc uuid;
  t_weld uuid; t_health uuid; t_constr uuid; t_hvac uuid; t_it uuid;
  dp_weld uuid; dp_health uuid; dp_constr uuid; dp_hvac uuid; dp_it uuid; dp_ag uuid;
  pr_weld uuid; pr_health uuid;
begin
  select id into v_lea from public.leas where system_code = '901';
  select id into v_year from public.school_years where is_current;
  select id into v_cycle from public.review_cycles where school_year_id = v_year;
  if v_lea is null or v_cycle is null then raise exception 'Riverbend County or the current cycle is missing'; end if;
  if exists (select 1 from public.lea_reviews where lea_id = v_lea and cycle_id = v_cycle) then
    raise notice 'Riverbend County is already on this cycle; nothing to do';
    return;
  end if;

  select id into v_hs from public.schools where lea_id = v_lea and school_code = '0010';
  select id into v_ctc from public.schools where lea_id = v_lea and school_code = '6000';
  select id into t_weld from public.teachers where lea_id = v_lea and display_name = 'Riley Blackwood';
  select id into t_health from public.teachers where lea_id = v_lea and display_name = 'Parker Larkin';
  select id into t_constr from public.teachers where lea_id = v_lea and display_name = 'Casey Everly';
  select id into t_hvac from public.teachers where lea_id = v_lea and display_name = 'Casey Calloway';
  select id into t_it from public.teachers where lea_id = v_lea and display_name = 'Parker Blackwood';

  -- Six declared programs. General Agriculture is vacant, so it stays out of the pool.
  insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type, source) values (v_lea, v_year, v_ctc, '10', 'LOCAL', 'manual') returning id into dp_weld;
  insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type, source) values (v_lea, v_year, v_hs, '17', 'LOCAL', 'manual') returning id into dp_health;
  insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type, source) values (v_lea, v_year, v_ctc, '11', 'LOCAL', 'manual') returning id into dp_constr;
  insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type, source) values (v_lea, v_year, v_ctc, '12', 'LOCAL', 'manual') returning id into dp_hvac;
  insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type, source) values (v_lea, v_year, v_hs, '13', 'LOCAL', 'manual') returning id into dp_it;
  insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type, source, vacant) values (v_lea, v_year, v_hs, '05', 'LOCAL', 'manual', true) returning id into dp_ag;
  insert into public.declared_program_teachers (declared_program_id, teacher_id) values (dp_weld, t_weld), (dp_health, t_health), (dp_constr, t_constr), (dp_hvac, t_hvac), (dp_it, t_it);

  -- On the list for December, visit on the 8th and 9th.
  insert into public.compliance_list (cycle_id, lea_id, review_month, review_year, source) values (v_cycle, v_lea, 12, 2026, 'manual');
  insert into public.lea_reviews (cycle_id, lea_id, status, review_month, review_year, choice1_start, choice1_end, choice2_start, choice2_end, visit_start, visit_end, notes)
    values (v_cycle, v_lea, 'listed', 12, 2026, '2026-12-08', '2026-12-09', '2026-12-15', '2026-12-16', '2026-12-08', '2026-12-09', 'Demonstration system with fabricated data.')
    returning id into v_review;

  -- Welding was nominated; Health Science came out of the draw.
  insert into public.selection_draws (lea_review_id, strategy, seed, target_count, pool, excluded, result)
    values (v_review, 'nominate_then_random', 'demo-riverbend', 2,
      jsonb_build_array(jsonb_build_object('declared_program_id', dp_health, 'program_code', '17'), jsonb_build_object('declared_program_id', dp_constr, 'program_code', '11'), jsonb_build_object('declared_program_id', dp_hvac, 'program_code', '12'), jsonb_build_object('declared_program_id', dp_it, 'program_code', '13')),
      jsonb_build_array(jsonb_build_object('declared_program_id', dp_ag, 'program_code', '05', 'reason', 'vacant')),
      jsonb_build_object('target', 2, 'already_selected', 1, 'drawn', jsonb_build_array(dp_health)))
    returning id into v_draw;
  insert into public.selections (lea_review_id, declared_program_id, method, nomination_reason) values (v_review, dp_weld, 'nominated', 'New welding lab opened this year.');
  insert into public.selections (lea_review_id, declared_program_id, method, draw_id) values (v_review, dp_health, 'random', v_draw);
  update public.lea_reviews set status = 'selected' where id = v_review;
  perform app.materialize_program_reviews(v_review);
  select id into pr_weld from public.program_reviews where lea_review_id = v_review and program_code = '10';
  select id into pr_health from public.program_reviews where lea_review_id = v_review and program_code = '17';

  -- Fabricated reviewers (invited by seed.mjs, not yet signed in).
  insert into public.review_assignments (program_review_id, email, display_name, assignment_role, sort) values
    (pr_weld, 'quinn.kingsley.933@state.example.gov', 'Quinn Kingsley', 'lead_reviewer', 1),
    (pr_weld, 'casey.larkin.404@state.example.gov', 'Casey Larkin', 'reviewer', 2),
    (pr_health, 'casey.larkin.404@state.example.gov', 'Casey Larkin', 'lead_reviewer', 1),
    (pr_health, 'quinn.kingsley.933@state.example.gov', 'Quinn Kingsley', 'reviewer', 2);

  -- Notification released.
  update public.lea_reviews set released_at = now(), status = 'released' where id = v_review;
  update public.program_reviews set status = 'released' where lea_review_id = v_review and status = 'selected';
  update public.milestones set completed_at = now() where lea_review_id = v_review and kind in ('check_in', 'notification');
  insert into public.audit_events (action, entity_type, entity_id, lea_id, meta) values ('demo.seeded', 'lea_reviews', v_review::text, v_lea, '{"note": "fabricated demonstration data for Riverbend County"}');
  raise notice 'Riverbend County demonstration review created: %', v_review;
end $$;
