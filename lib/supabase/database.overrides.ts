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
};
