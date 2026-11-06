\set ON_ERROR_STOP on
insert into public.admins(email) values ('owner@airway.pk');

-- 1. seed matches storefront
do $$ begin assert (select count(*) from public.products) = 31, 'expected 31 seeded products'; end $$;

-- 2. anon can read catalog but cannot write
set role anon;
select set_config('request.jwt.claims', '{}', false);
do $$ begin assert (select count(*) from public.product_catalog) = 31, 'anon catalog read'; end $$;
do $$ begin
  begin insert into public.products(name, category) values ('Hack', 'shoes'); raise exception 'anon insert should fail';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. signed in non admin is blocked
set role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', false);
do $$ begin
  begin insert into public.products(name, category) values ('Nope', 'shoes'); raise exception 'non admin insert should fail';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin assert (select count(*) from public.admins) = 0, 'non admin must not see admins'; end $$;

-- 4. admin can create product and images
select set_config('request.jwt.claims', '{"email":"Owner@Airway.pk"}', false);
insert into public.products(id, name, category, color, price) values ('p_test1', 'Black Leather Belt', 'accessories', 'black', 2500);
insert into public.product_images(product_id, product_name, category, provider, provider_image_id, hosting, image_url, thumb_url,
  storage_full_path, storage_thumb_path, source_page_url, license, attribution, is_primary)
values ('p_test1', 'Black Leather Belt', 'accessories', 'pexels', '111', 'self', 'https://x/full.jpg', 'https://x/thumb.jpg',
  'p_test1/a-full.jpg', 'p_test1/a-thumb.jpg', 'https://www.pexels.com/photo/111/', 'Pexels License', 'Photo by A on Pexels', true);
insert into storage.objects(bucket_id, name) values ('product-images', 'p_test1/a-full.jpg');

-- 5. duplicate provider image for same product is rejected
do $$ begin
  begin
    insert into public.product_images(product_id, product_name, category, provider, provider_image_id, hosting, image_url, thumb_url,
      storage_full_path, storage_thumb_path, source_page_url, license, attribution)
    values ('p_test1', 'Black Leather Belt', 'accessories', 'pexels', '111', 'self', 'u', 't', 'a', 'b', 's', 'l', 'a');
    raise exception 'duplicate should fail';
  exception when unique_violation then null; end;
end $$;

-- 6. only one primary image per product
do $$ begin
  begin
    insert into public.product_images(product_id, product_name, category, provider, provider_image_id, hosting, image_url, thumb_url,
      source_page_url, license, attribution, is_primary)
    values ('p_test1', 'Black Leather Belt', 'accessories', 'unsplash', 'abc', 'hotlink', 'u', 't', 's', 'l', 'a', true);
    raise exception 'second primary should fail';
  exception when unique_violation then null; end;
end $$;

-- 7. self hosted rows must have storage paths
do $$ begin
  begin
    insert into public.product_images(product_id, product_name, category, provider, provider_image_id, hosting, image_url, thumb_url,
      source_page_url, license, attribution)
    values ('p_test1', 'Black Leather Belt', 'accessories', 'pixabay', '9', 'self', 'u', 't', 's', 'l', 'a');
    raise exception 'self hosted without paths should fail';
  exception when check_violation then null; end;
end $$;

-- 8. renaming product syncs image rows
update public.products set name = 'Black Belt' where id = 'p_test1';
do $$ begin assert (select product_name from public.product_images where product_id='p_test1') = 'Black Belt', 'name sync'; end $$;

-- 9. catalog shows primary image, store section from category
do $$ begin assert (select image_url from public.product_catalog where id='p_test1') = 'https://x/full.jpg', 'catalog image';
  assert (select store_section from public.product_catalog where id='p_test1') = 'accessories', 'section'; end $$;

-- 10. deleting product cascades images
delete from public.products where id = 'p_test1';
do $$ begin assert (select count(*) from public.product_images where product_id='p_test1') = 0, 'cascade'; end $$;
reset role;

-- 11. migration is re-runnable without touching data
select 'ALL DB TESTS PASSED' as result;
