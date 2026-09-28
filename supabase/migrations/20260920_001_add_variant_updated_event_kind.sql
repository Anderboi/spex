-- ============================================================================
-- Новый тип события истории: variant_updated
-- ============================================================================
--
-- Вариант замены — отдельная запись `spec_item_variants` со своими полями
-- (название, бренд, артикул, спецификация, цена, ссылка, картинка, срок,
-- поставщик), и правится она своей mutation — `updateVariant` в
-- actions/spec-variants.ts, — а не патчем позиции. Поэтому у правки варианта
-- своё событие, а в `details_changed` эти поля не попадают: там речь только о
-- колонках `spec_items`.
--
-- В Postgres нельзя добавить одно значение в существующий `check (kind in …)`:
-- ограничение переписывается целиком. Список остаётся синхронизированным с
-- SPEC_ITEM_EVENT_KINDS — рассинхрон ловит тест lib/spec/history.test.ts,
-- который берёт ПОСЛЕДНЕЕ определение ограничения по всем миграциям.

alter table public.spec_item_events
  drop constraint if exists spec_item_events_kind_check;

alter table public.spec_item_events
  add constraint spec_item_events_kind_check
  check (
    kind in (
      'created',
      'filled',
      'cleared',
      'removed',
      'restored',
      'code_changed',
      'status_changed',
      'price_changed',
      'quantity_changed',
      'supplier_changed',
      'details_changed',
      'parent_changed',
      'variant_added',
      'variant_switched',
      -- Правка данных варианта: variant_id и карта изменившихся полей.
      'variant_updated',
      'component_added',
      'component_removed',
      'service_added',
      'service_completed',
      'service_removed'
    )
  );
