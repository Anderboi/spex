export type CustomFunctions = {
  set_spec_item_code: {
    Args: {
      p_org_id: string;
      p_project_id: string;
      p_item_id: string;
      p_code: string;
      p_allow_swap: boolean;
    };
    Returns: {
      result: "ok" | "swapped" | "unchanged";
      swapped_id: string | null;
      swapped_name: string | null;
    }[];
  };
  accept_invite: {
    Args: { p_token: string; p_user_id: string; p_email: string };
    Returns: { org_id: string; org_slug: string; org_name: string }[];
  };
  /**
   * Переименование организации. Возвращает сохранённое (обрезанное) название.
   * Только owner — проверяется внутри функции (см. миграцию
   * 20260916_001_organization_roles_owner_admin_member.sql).
   */
  update_organization_name: {
    Args: { p_org_id: string; p_actor_id: string; p_name: string };
    Returns: string;
  };
  /**
   * Атомарная передача владения: старый owner → admin, новый → owner.
   * Блокирует состав организации (`for update`), поэтому двух владельцев или
   * организации без владельца в промежуточном состоянии не возникает.
   */
  transfer_organization_ownership: {
    Args: { p_org_id: string; p_actor_id: string; p_target_name: string };
    Returns: null;
  };
  create_manual_spec_item: {
    Args: {
      p_org_id: string;
      p_project_id: string;
      p_item_id: string;
      p_material_id: string | null;
      p_company_id: string | null;
      p_company_name: string | null;
      p_created_by: string;
      p_image_url: string | null;
      p_code: string;
      p_type: string;
      p_name: string;
      p_brand: string | null;
      p_spec: string | null;
      p_article: string | null;
      p_qty: number;
      p_unit: string;
      p_price: number;
      p_stock_pct: number;
      p_client_discount_pct: number;
      p_supplier_discount_pct: number;
      p_save_to_library: boolean;
      p_parent_id: string | null;
      /** Тип материала внутри категории: керамогранит, ламинат, обои, … */
      p_product_type: string | null;
      p_product_url: string | null;
      p_lead_time: string | null;
      /** Характеристики: ключ → значение. */
      p_attrs: Record<string, string>;
    };
    Returns: { id: string }[];
  };
};
