-- CANDIDATE ONLY. Used by isolated tests. Not in supabase/migrations; NOT applied to DEV.
-- Requires matching-engine review, non-null verified locations and writer approval.
alter table public.review_locations add constraint review_locations_id_company_uq unique(id,company_id);
alter table public.review_external_reviews alter column location_id set not null;
alter table public.review_external_reviews drop constraint review_external_reviews_location_id_fkey;
alter table public.review_external_reviews add constraint review_external_reviews_location_company_fk
  foreign key(location_id,company_id) references public.review_locations(id,company_id)
  on delete no action deferrable initially deferred;
create unique index review_external_reviews_company_location_provider_id_uq
  on public.review_external_reviews(company_id,location_id,provider,external_review_id);
alter table public.review_external_reviews drop constraint review_external_reviews_company_id_provider_external_review_key;
drop index public.review_external_reviews_provider_external_id_uq;
