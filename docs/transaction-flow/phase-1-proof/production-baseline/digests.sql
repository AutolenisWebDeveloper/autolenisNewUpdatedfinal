with
tbls as (select md5(string_agg(c.relname,',' order by c.relname)) d from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
cols as (select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'~'),',' order by table_name,column_name)) d from information_schema.columns where table_schema='public'),
idx as (select md5(string_agg(indexname||'='||indexdef,',' order by indexname)) d from pg_indexes where schemaname='public'),
cons as (select md5(string_agg(c.conname||'='||pg_get_constraintdef(c.oid),',' order by c.conname)) d from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public'),
enums as (select md5(string_agg(t.typname||'.'||e.enumlabel,',' order by t.typname,e.enumsortorder)) d from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'),
trg as (select md5(string_agg(t.tgname||'='||pg_get_triggerdef(t.oid),',' order by t.tgname)) d from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
pol as (select md5(string_agg(tablename||'.'||policyname||'='||cmd||':'||roles::text||':'||coalesce(qual,'~')||':'||coalesce(with_check,'~'),',' order by tablename,policyname)) d from pg_policies where schemaname='public'),
fn as (select md5(string_agg(p.proname||'='||pg_get_functiondef(p.oid),',' order by p.proname)) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
select 'tables_d='||(select d from tbls), 'cols_d='||(select d from cols), 'idx_d='||(select d from idx), 'cons_d='||(select d from cons), 'enums_d='||(select d from enums), 'trg_d='||(select d from trg), 'pol_d='||(select d from pol), 'fn_d='||(select d from fn);
