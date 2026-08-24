export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          access_token: string | null
          expires_at: number | null
          id: string
          id_token: string | null
          provider: string
          provider_account_id: string
          refresh_token: string | null
          scope: string | null
          session_state: string | null
          token_type: string | null
          type: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          expires_at?: number | null
          id?: string
          id_token?: string | null
          provider: string
          provider_account_id: string
          refresh_token?: string | null
          scope?: string | null
          session_state?: string | null
          token_type?: string | null
          type: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          expires_at?: number | null
          id?: string
          id_token?: string | null
          provider?: string
          provider_account_id?: string
          refresh_token?: string | null
          scope?: string | null
          session_state?: string | null
          token_type?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          category: string[]
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          note: string | null
          org_id: string
          phone: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          category: string[]
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          note?: string | null
          org_id: string
          phone?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          category?: string[]
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          note?: string | null
          org_id?: string
          phone?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          category: string[]
          company_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          note: string | null
          org_id: string
          phone: string | null
          title: string | null
        }
        Insert: {
          category: string[]
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          note?: string | null
          org_id: string
          phone?: string | null
          title?: string | null
        }
        Update: {
          category?: string[]
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          note?: string | null
          org_id?: string
          phone?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          article: string | null
          attachments: string | null
          brand: string | null
          category: string
          company_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          image_url: string | null
          lead_time: string | null
          name: string
          notes: string | null
          org_id: string
          price: number
          product_description: string | null
          product_type: string | null
          product_url: string | null
          tags: string[] | null
          unit: string
          updated_at: string
        }
        Insert: {
          article?: string | null
          attachments?: string | null
          brand?: string | null
          category?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          lead_time?: string | null
          name: string
          notes?: string | null
          org_id: string
          price?: number
          product_description?: string | null
          product_type?: string | null
          product_url?: string | null
          tags?: string[] | null
          unit?: string
          updated_at?: string
        }
        Update: {
          article?: string | null
          attachments?: string | null
          brand?: string | null
          category?: string
          company_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          lead_time?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          price?: number
          product_description?: string | null
          product_type?: string | null
          product_url?: string | null
          tags?: string[] | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_tokens: {
        Row: {
          created_at: string | null
          email: string
          expires: string
          id: string
          token: string
        }
        Insert: {
          created_at?: string | null
          email: string
          expires: string
          id?: string
          token: string
        }
        Update: {
          created_at?: string | null
          email?: string
          expires?: string
          id?: string
          token?: string
        }
        Relationships: []
      }
      project_service_items: {
        Row: {
          item_id: string
          service_id: string
        }
        Insert: {
          item_id: string
          service_id: string
        }
        Update: {
          item_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_service_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "spec_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "spec_items_priced"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_service_items_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "project_services"
            referencedColumns: ["id"]
          },
        ]
      }
      project_services: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          project_id: string
          status: string
          supplier_id: string | null
          supplier_snapshot: string | null
          title: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          notes?: string | null
          project_id: string
          status: string
          supplier_id?: string | null
          supplier_snapshot?: string | null
          title: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string
          status?: string
          supplier_id?: string | null
          supplier_snapshot?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_services_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          accent_color: string | null
          address: string | null
          budget: number | null
          client_name: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          org_id: string
          status: string
          title: string
          type: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          address?: string | null
          budget?: number | null
          client_name?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          org_id: string
          status?: string
          title: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          address?: string | null
          budget?: number | null
          client_name?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          org_id?: string
          status?: string
          title?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reserved_slugs: {
        Row: {
          slug: string
        }
        Insert: {
          slug: string
        }
        Update: {
          slug?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          expires: string
          id: string
          session_token: string
          user_id: string
        }
        Insert: {
          expires: string
          id?: string
          session_token: string
          user_id: string
        }
        Update: {
          expires?: string
          id?: string
          session_token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_items: {
        Row: {
          article: string | null
          attachments: string | null
          attrs: Json
          avail: string | null
          base_price: number
          brand: string | null
          client_discount: number
          client_discount_pct: number
          code: string | null
          company_id: string | null
          company_name_snapshot: string | null
          contact_id: string | null
          contact_name_snapshot: string | null
          created_at: string
          cutting_stock: number
          deleted_at: string | null
          id: string
          image_url: string | null
          is_placeholder: boolean
          lead_time: string | null
          material_id: string | null
          name: string
          notes: string | null
          org_id: string
          position: number
          price: number
          product_type: string | null
          product_url: string | null
          project_id: string
          qty: number
          rooms: string[]
          spec: string | null
          status: Database["public"]["Enums"]["spec_status"]
          stock_pct: number
          supplier_discount: number
          supplier_discount_pct: number
          type: string
          unit: string
          updated_at: string
        }
        Insert: {
          article?: string | null
          attachments?: string | null
          attrs?: Json
          avail?: string | null
          base_price?: number
          brand?: string | null
          client_discount?: number
          client_discount_pct?: number
          code?: string | null
          company_id?: string | null
          company_name_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          created_at?: string
          cutting_stock?: number
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          is_placeholder?: boolean
          lead_time?: string | null
          material_id?: string | null
          name: string
          notes?: string | null
          org_id: string
          position?: number
          price?: number
          product_type?: string | null
          product_url?: string | null
          project_id: string
          qty?: number
          rooms?: string[]
          spec?: string | null
          status?: Database["public"]["Enums"]["spec_status"]
          stock_pct?: number
          supplier_discount?: number
          supplier_discount_pct?: number
          type?: string
          unit?: string
          updated_at?: string
        }
        Update: {
          article?: string | null
          attachments?: string | null
          attrs?: Json
          avail?: string | null
          base_price?: number
          brand?: string | null
          client_discount?: number
          client_discount_pct?: number
          code?: string | null
          company_id?: string | null
          company_name_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          created_at?: string
          cutting_stock?: number
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          is_placeholder?: boolean
          lead_time?: string | null
          material_id?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          position?: number
          price?: number
          product_type?: string | null
          product_url?: string | null
          project_id?: string
          qty?: number
          rooms?: string[]
          spec?: string | null
          status?: Database["public"]["Enums"]["spec_status"]
          stock_pct?: number
          supplier_discount?: number
          supplier_discount_pct?: number
          type?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active_org_id: string | null
          created_at: string | null
          email: string | null
          email_verified: string | null
          id: string
          image: string | null
          name: string | null
          password: string | null
        }
        Insert: {
          active_org_id?: string | null
          created_at?: string | null
          email?: string | null
          email_verified?: string | null
          id?: string
          image?: string | null
          name?: string | null
          password?: string | null
        }
        Update: {
          active_org_id?: string | null
          created_at?: string | null
          email?: string | null
          email_verified?: string | null
          id?: string
          image?: string | null
          name?: string | null
          password?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_active_org_id_fkey"
            columns: ["active_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_tokens: {
        Row: {
          expires: string
          identifier: string
          token: string
        }
        Insert: {
          expires: string
          identifier: string
          token: string
        }
        Update: {
          expires?: string
          identifier?: string
          token?: string
        }
        Relationships: []
      }
    }
    Views: {
      spec_items_priced: {
        Row: {
          article: string | null
          attrs: Json | null
          avail: string | null
          base_price: number | null
          brand: string | null
          client_discount: number | null
          client_discount_pct: number | null
          code: string | null
          company_id: string | null
          company_name_snapshot: string | null
          contact_id: string | null
          contact_name_snapshot: string | null
          created_at: string | null
          cutting_stock: number | null
          deleted_at: string | null
          id: string | null
          is_placeholder: boolean | null
          lead_time: string | null
          material_id: string | null
          name: string | null
          notes: string | null
          org_id: string | null
          position: number | null
          price: number | null
          price_final: number | null
          project_id: string | null
          qty: number | null
          qty_final: number | null
          rooms: string[] | null
          spec: string | null
          status: Database["public"]["Enums"]["spec_status"] | null
          stock_pct: number | null
          supplier_discount: number | null
          supplier_discount_pct: number | null
          type: string | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          article?: string | null
          attrs?: Json | null
          avail?: string | null
          base_price?: number | null
          brand?: string | null
          client_discount?: number | null
          client_discount_pct?: number | null
          code?: string | null
          company_id?: string | null
          company_name_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          created_at?: string | null
          cutting_stock?: number | null
          deleted_at?: string | null
          id?: string | null
          is_placeholder?: boolean | null
          lead_time?: string | null
          material_id?: string | null
          name?: string | null
          notes?: string | null
          org_id?: string | null
          position?: number | null
          price?: number | null
          price_final?: never
          project_id?: string | null
          qty?: number | null
          qty_final?: never
          rooms?: string[] | null
          spec?: string | null
          status?: Database["public"]["Enums"]["spec_status"] | null
          stock_pct?: number | null
          supplier_discount?: number | null
          supplier_discount_pct?: number | null
          type?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          article?: string | null
          attrs?: Json | null
          avail?: string | null
          base_price?: number | null
          brand?: string | null
          client_discount?: number | null
          client_discount_pct?: number | null
          code?: string | null
          company_id?: string | null
          company_name_snapshot?: string | null
          contact_id?: string | null
          contact_name_snapshot?: string | null
          created_at?: string | null
          cutting_stock?: number | null
          deleted_at?: string | null
          id?: string | null
          is_placeholder?: boolean | null
          lead_time?: string | null
          material_id?: string | null
          name?: string | null
          notes?: string | null
          org_id?: string | null
          position?: number | null
          price?: number | null
          price_final?: never
          project_id?: string | null
          qty?: number | null
          qty_final?: never
          rooms?: string[] | null
          spec?: string | null
          status?: Database["public"]["Enums"]["spec_status"] | null
          stock_pct?: number | null
          supplier_discount?: number | null
          supplier_discount_pct?: number | null
          type?: string | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invite: {
        Args: { p_email: string; p_token: string; p_user_id: string }
        Returns: {
          org_id: string
          org_name: string
          org_slug: string
        }[]
      }
      create_manual_spec_item:
        | {
            Args: {
              p_article: string
              p_brand: string
              p_client_discount_pct: number
              p_code: string
              p_company_id: string
              p_company_name: string
              p_created_by: string
              p_item_id: string
              p_material_id: string
              p_name: string
              p_org_id: string
              p_price: number
              p_project_id: string
              p_qty: number
              p_save_to_library: boolean
              p_spec: string
              p_stock_pct: number
              p_supplier_discount_pct: number
              p_type: string
              p_unit: string
            }
            Returns: {
              id: string
            }[]
          }
        | {
            Args: {
              p_article: string
              p_brand: string
              p_client_discount_pct: number
              p_code: string
              p_company_id: string
              p_company_name: string
              p_created_by: string
              p_image_url: string
              p_item_id: string
              p_material_id: string
              p_name: string
              p_org_id: string
              p_price: number
              p_project_id: string
              p_qty: number
              p_save_to_library: boolean
              p_spec: string
              p_stock_pct: number
              p_supplier_discount_pct: number
              p_type: string
              p_unit: string
            }
            Returns: {
              id: string
            }[]
          }
      create_organization:
        | { Args: { p_name: string }; Returns: string }
        | { Args: { p_name: string; p_user_id: string }; Returns: string }
        | {
            Args: { p_name: string; p_slug_base?: string; p_user_id: string }
            Returns: {
              org_id: string
              org_slug: string
            }[]
          }
      ensure_personal_org: { Args: { p_user_id: string }; Returns: string }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      set_spec_item_code: {
        Args: {
          p_allow_swap?: boolean
          p_code: string
          p_item_id: string
          p_org_id: string
          p_project_id: string
        }
        Returns: {
          result: string
          swapped_id: string
          swapped_name: string
        }[]
      }
      slugify: { Args: { p_text: string }; Returns: string }
      unique_org_slug: { Args: { p_base: string }; Returns: string }
    }
    Enums: {
      org_role: "owner" | "admin" | "member" | "viewer"
      spec_status:
        | "draft"
        | "picked"
        | "approved"
        | "ordered"
        | "delivered"
        | "replace"
      spec_types:
        | "Отделка"
        | "Мебель"
        | "Оборудование"
        | "Сантехника"
        | "Освещение"
        | "Текстиль"
        | "Инженерное оборудование"
        | "Декор"
        | "Двери"
        | "Электрика"
        | "Прочее"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      org_role: ["owner", "admin", "member", "viewer"],
      spec_status: [
        "draft",
        "picked",
        "approved",
        "ordered",
        "delivered",
        "replace",
      ],
      spec_types: [
        "Отделка",
        "Мебель",
        "Оборудование",
        "Сантехника",
        "Освещение",
        "Текстиль",
        "Инженерное оборудование",
        "Декор",
        "Двери",
        "Электрика",
        "Прочее",
      ],
    },
  },
} as const
