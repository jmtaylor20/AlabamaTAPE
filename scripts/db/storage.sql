-- Private evidence bucket. Applied to the Supabase project by hand (the local
-- policy test database has no storage schema). No storage policies are created
-- on purpose: only the server's service role touches objects, and it does so
-- only after the database has allowed an evidence_access row for the caller.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 41943040, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'image/png', 'image/jpeg', 'image/gif', 'image/heic', 'image/heif',
  'video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
