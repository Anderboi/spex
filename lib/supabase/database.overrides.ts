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
    };
    Returns: { id: string }[];
  };
};
