-- 5. Enumerate current RLS status on coding_tasks, coding_tasks_errors, api_usage_logs, and any knowledge-base table.
-- Since we are auditing and applying, we will enable RLS for these tables and apply open policies so app still functions.

ALTER TABLE IF EXISTS public.coding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.coding_tasks_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.knowledge_nodes ENABLE ROW LEVEL SECURITY;

-- 6. Turn it on with policies that currently allow the same read/write behavior the app already relies on
CREATE POLICY "Allow anon read/write for coding_tasks" ON public.coding_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon read/write for coding_tasks_errors" ON public.coding_tasks_errors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon read/write for api_usage_logs" ON public.api_usage_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon read/write for knowledge_nodes" ON public.knowledge_nodes FOR ALL USING (true) WITH CHECK (true);
