-- Removes everything seed-riverbend.sql created for Riverbend County (system
-- 901), plus anything a demonstration added on top of it: evidence rows,
-- scores, findings, drafts, plans. The system, its schools, and its teachers
-- stay, as seed.mjs made them. Append-only tables are cleared with their
-- guards off, which needs the database owner. Evidence files in storage are
-- listed at the end for removal through the dashboard or the storage API.
do $$
declare v_lea uuid; v_year uuid; v_cycle uuid; v_review uuid;
begin
  select id into v_lea from public.leas where system_code = '901';
  select id into v_year from public.school_years where is_current;
  select id into v_cycle from public.review_cycles where school_year_id = v_year;
  select id into v_review from public.lea_reviews where lea_id = v_lea and cycle_id = v_cycle;
  if v_lea is null then raise exception 'Riverbend County is missing'; end if;

  -- Guards off for the append-only tables, inside this transaction only.
  set local session_replication_role = replica;

  if v_review is not null then
    delete from public.pip_escalations where pip_id in (select id from public.pips where program_review_id in (select id from public.program_reviews where lea_review_id = v_review));
    delete from public.pip_notes where pip_id in (select id from public.pips where program_review_id in (select id from public.program_reviews where lea_review_id = v_review));
    delete from public.pip_progress where pip_id in (select id from public.pips where program_review_id in (select id from public.program_reviews where lea_review_id = v_review));
    delete from public.pip_goals where pip_id in (select id from public.pips where program_review_id in (select id from public.program_reviews where lea_review_id = v_review));
    delete from public.pips where program_review_id in (select id from public.program_reviews where lea_review_id = v_review);
    delete from public.finalizations where program_review_id in (select id from public.program_reviews where lea_review_id = v_review);
    delete from public.findings where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.desk_audits where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.onsite_checks where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.audit_samples where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.section_comments where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.epic_scores where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.score_entries where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.consistency_meetings where lea_review_id = v_review;
    delete from public.email_drafts where lea_review_id = v_review;
    delete from public.scope_changes where lea_review_id = v_review;
    delete from public.program_review_site_teachers where site_id in (select s.id from public.program_review_sites s join public.program_reviews p on p.id = s.program_review_id where p.lea_review_id = v_review);
    delete from public.program_review_sites where program_review_id in (select id from public.program_reviews where lea_review_id = v_review);
    delete from public.review_assignments where program_review_id in (select id from public.program_reviews where lea_review_id = v_review);
    delete from public.program_reviews where lea_review_id = v_review;
    delete from public.selections where lea_review_id = v_review;
    delete from public.selection_draws where lea_review_id = v_review;
    delete from public.milestones where lea_review_id = v_review;
    delete from public.lea_reviews where id = v_review;
  end if;
  delete from public.compliance_list where lea_id = v_lea and cycle_id = v_cycle;

  -- District-side records for the year.
  delete from public.evidence_access where file_id in (select id from public.evidence_files where lea_id = v_lea);
  delete from public.evidence_qpi_links where file_id in (select id from public.evidence_files where lea_id = v_lea);
  delete from public.evidence_files where lea_id = v_lea;
  delete from public.form_141_items where form_id in (select id from public.form_141 where lea_id = v_lea);
  delete from public.form_141 where lea_id = v_lea;
  delete from public.credential_results where lea_id = v_lea;
  delete from public.declaration_revisions where lea_id = v_lea and school_year_id = v_year;
  delete from public.declaration_windows where lea_id = v_lea and school_year_id = v_year;
  delete from public.declared_program_teachers where declared_program_id in (select id from public.declared_programs where lea_id = v_lea and school_year_id = v_year);
  delete from public.declared_programs where lea_id = v_lea and school_year_id = v_year;
  delete from public.audit_events where action = 'demo.seeded' and lea_id = v_lea;
  raise notice 'Riverbend County demonstration data removed';
end $$;

-- Storage objects left behind by demonstration uploads, if any, listed as notices.
do $$
declare rec record; n integer := 0;
begin
  if to_regclass('storage.objects') is null then return; end if;
  for rec in execute $q$ select name, created_at from storage.objects where bucket_id = 'evidence' and name like (select id::text || '/%' from public.leas where system_code = '901') order by created_at $q$ loop
    n := n + 1;
    raise notice 'storage object to remove: % (%)', rec.name, rec.created_at;
  end loop;
  raise notice '% storage object(s) remain for Riverbend County', n;
end $$;
