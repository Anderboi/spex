-- ============================================================================
-- Новый тип события истории: variant_removed
-- ============================================================================
--
-- Вариант замены удаляется физически: у `spec_item_variants` нет `deleted_at`,
-- строка исчезает, и восстановить её нечем. Владелец удаления — `deleteVariant`
-- в actions/spec-variants.ts, туда же пишется и событие: снимок варианта
-- (название, подпись, признак активности) снимается до mutation, потому что
-- после DELETE читать уже нечего.
--
-- Удаление активного варианта в той же mutation назначает активным первый
-- оставшийся — это техническое следствие, а не выбор пользователя, поэтому
-- отдельного `variant_switched` не пишется: преемник зафиксирован внутри
-- `variant_removed` (`next_active`).
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
      'variant_updated',
      -- Удаление варианта: снимок удалённой строки и её преемник.
      'variant_removed',
      'component_added',
      'component_removed',
      'service_added',
      'service_completed',
      'service_removed'
    )
  );
