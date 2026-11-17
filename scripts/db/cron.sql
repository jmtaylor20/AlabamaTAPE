-- Daily PIP escalation check inside the database. Applied to the Supabase
-- project by hand; pg_cron is a Supabase extension and is not part of the
-- local policy test database.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'tape-pip-escalations';
select cron.schedule('tape-pip-escalations', '15 11 * * *', $$select app.run_pip_escalations();$$);
