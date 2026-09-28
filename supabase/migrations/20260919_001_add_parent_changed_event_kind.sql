-- ============================================================================
-- Новый тип события истории: parent_changed
-- ============================================================================
--
-- Родитель позиции (`spec_items.parent_id`) меняется отдельным пользовательским
-- жестом — пунктом «В состав…» в меню строки, — а не общим патчем-полем: это
-- связь между позициями, а не значение. Поэтому у смены родителя своё событие,
-- и в `details_changed` это поле не попадает (см. SPEC_ITEM_DETAIL_FIELDS в
-- lib/spec/history.ts).
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
      -- Смена родителя: читаемый снимок прежнего и нового родителя.
      'parent_changed',
      'variant_added',
      'variant_switched',
      'component_added',
      'component_removed',
      'service_added',
      'service_completed',
      'service_removed'
    )
  );
