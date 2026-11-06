-- Airway product image system
-- Adds categories, products, product_images and admins tables, row level security,
-- and a public storage bucket for imported images.
-- Purely additive: it creates new objects only and never drops or alters existing ones.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------
create table if not exists public.admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------
-- Categories (image search categories mapped to store sections)
-- ---------------------------------------------------------------
create table if not exists public.categories (
  key text primary key,
  label text not null,
  store_section text not null check (store_section in ('shirts','trousers','clothes','shoes','dress','accessories')),
  search_terms text[] not null default '{}',
  sort int not null default 0
);

insert into public.categories (key, label, store_section, search_terms, sort) values
  ('mens_shirts',    'Men''s shirts',      'shirts',      array['shirt','button down','oxford','linen shirt','dress shirt'], 1),
  ('tshirts',        'T-shirts',           'shirts',      array['t-shirt','tshirt','tee','polo'], 2),
  ('jeans_trousers', 'Jeans and trousers', 'trousers',    array['jeans','denim','trousers','pants','chinos','cargo'], 3),
  ('hoodies',        'Hoodies',            'shirts',      array['hoodie','sweatshirt','hooded'], 4),
  ('jackets',        'Jackets',            'clothes',     array['jacket','coat','bomber','puffer','parka'], 5),
  ('womens_dresses', 'Women''s dresses',   'dress',       array['dress','gown','maxi','midi'], 6),
  ('shoes',          'Shoes',              'shoes',       array['shoes','sneakers','boots','loafers','heels','sandals'], 7),
  ('accessories',    'Accessories',        'accessories', array['bag','belt','watch','cap','scarf','sunglasses','wallet'], 8),
  ('shalwar_kameez', 'Shalwar kameez',     'dress',       array['kurta','shalwar kameez','salwar','kameez'], 9),
  ('mens_suits',     'Men''s suits',       'dress',       array['suit','blazer','waistcoat'], 10),
  ('outfit_sets',    'Outfit sets',        'dress',       array['outfit','flat lay','clothing set'], 11)
on conflict (key) do nothing;

-- ---------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------
create table if not exists public.products (
  id text primary key default ('p_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  name text not null check (length(trim(name)) > 1),
  category text not null references public.categories(key),
  color text,
  price integer not null default 0 check (price >= 0),
  description text,
  sizes text[],
  attributes jsonb not null default '{}'::jsonb,  -- drawing parameters used by the storefront fallback art
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Product images
-- ---------------------------------------------------------------
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  product_name text not null,
  category text not null,
  provider text not null check (provider in ('pexels','unsplash','pixabay')),
  provider_image_id text not null,
  hosting text not null check (hosting in ('self','hotlink')),
  image_url text not null,
  thumb_url text not null,
  storage_full_path text,
  storage_thumb_path text,
  source_page_url text not null,
  photographer text,
  photographer_url text,
  license text not null,
  attribution text not null,
  width integer,
  height integer,
  phash text,
  color_hex text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, provider, provider_image_id),
  check (hosting = 'hotlink' or (storage_full_path is not null and storage_thumb_path is not null))
);

create unique index if not exists product_images_one_primary
  on public.product_images (product_id) where is_primary;
create index if not exists product_images_product_idx on public.product_images (product_id);
create index if not exists product_images_provider_idx on public.product_images (provider, provider_image_id);

-- keep timestamps and denormalized name/category in sync
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

create or replace function public.sync_image_product_fields() returns trigger language plpgsql as $$
begin
  if new.name is distinct from old.name or new.category is distinct from old.category then
    update public.product_images set product_name = new.name, category = new.category
    where product_id = new.id;
  end if;
  return new;
end; $$;

drop trigger if exists products_sync_images on public.products;
create trigger products_sync_images after update on public.products
  for each row execute function public.sync_image_product_fields();

-- storefront read model: each active product with its primary image
create or replace view public.product_catalog
with (security_invoker = true) as
select p.id, p.name, p.category, c.label as category_label, c.store_section,
       p.color, p.price, p.description, p.sizes, p.attributes, p.created_at,
       i.image_url, i.thumb_url, i.attribution, i.photographer, i.photographer_url,
       i.source_page_url, i.provider
from public.products p
join public.categories c on c.key = p.category
left join public.product_images i on i.product_id = p.id and i.is_primary
where p.is_active;

-- ---------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;

drop policy if exists admins_admin_read on public.admins;
create policy admins_admin_read on public.admins for select to authenticated using (public.is_admin());

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select to anon, authenticated using (true);
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists products_read on public.products;
create policy products_read on public.products for select to anon, authenticated
  using (is_active or public.is_admin());
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists product_images_read on public.product_images;
create policy product_images_read on public.product_images for select to anon, authenticated using (true);
drop policy if exists product_images_admin_write on public.product_images;
create policy product_images_admin_write on public.product_images for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.categories, public.products, public.product_images, public.product_catalog to anon, authenticated;
grant insert, update, delete on public.products, public.product_images, public.categories to authenticated;
grant select on public.admins to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------
-- Storage bucket for self hosted images (Pexels and Pixabay)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');
drop policy if exists product_images_admin_insert on storage.objects;
create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());
drop policy if exists product_images_admin_update on storage.objects;
create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
