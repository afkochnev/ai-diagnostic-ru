export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      company_profiles: {
        Row: {
          annual_revenue_key: string
          company_age_years: number
          country: string
          created_at: string
          customer_segments: string
          employee_count: number
          id: string
          industry_key: string
          key_problems: string
          main_goals: string
          management_levels: number
          name: string
          owner_user_id: string
          products: string
          revision: number
          sales_channels: string
          updated_at: string
        }
        Insert: {
          annual_revenue_key: string
          company_age_years: number
          country: string
          created_at?: string
          customer_segments: string
          employee_count: number
          id?: string
          industry_key: string
          key_problems: string
          main_goals: string
          management_levels: number
          name: string
          owner_user_id: string
          products: string
          revision?: number
          sales_channels: string
          updated_at?: string
        }
        Update: {
          annual_revenue_key?: string
          company_age_years?: number
          country?: string
          created_at?: string
          customer_segments?: string
          employee_count?: number
          id?: string
          industry_key?: string
          key_problems?: string
          main_goals?: string
          management_levels?: number
          name?: string
          owner_user_id?: string
          products?: string
          revision?: number
          sales_channels?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_profiles_annual_revenue_key_fkey"
            columns: ["annual_revenue_key"]
            isOneToOne: false
            referencedRelation: "revenue_ranges"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "company_profiles_industry_key_fkey"
            columns: ["industry_key"]
            isOneToOne: false
            referencedRelation: "industries"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "company_profiles_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_documents: {
        Row: {
          is_temporary: boolean
          kind: string
          version: string
        }
        Insert: {
          is_temporary?: boolean
          kind: string
          version: string
        }
        Update: {
          is_temporary?: boolean
          kind?: string
          version?: string
        }
        Relationships: []
      }
      industries: {
        Row: {
          is_active: boolean
          key: string
          sort_order: number
        }
        Insert: {
          is_active?: boolean
          key: string
          sort_order: number
        }
        Update: {
          is_active?: boolean
          key?: string
          sort_order?: number
        }
        Relationships: []
      }
      industry_translations: {
        Row: {
          industry_key: string
          locale: string
          name: string
        }
        Insert: {
          industry_key: string
          locale: string
          name: string
        }
        Update: {
          industry_key?: string
          locale?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "industry_translations_industry_key_fkey"
            columns: ["industry_key"]
            isOneToOne: false
            referencedRelation: "industries"
            referencedColumns: ["key"]
          },
        ]
      }
      revenue_range_translations: {
        Row: {
          locale: string
          name: string
          revenue_key: string
        }
        Insert: {
          locale: string
          name: string
          revenue_key: string
        }
        Update: {
          locale?: string
          name?: string
          revenue_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_range_translations_revenue_key_fkey"
            columns: ["revenue_key"]
            isOneToOne: false
            referencedRelation: "revenue_ranges"
            referencedColumns: ["key"]
          },
        ]
      }
      revenue_ranges: {
        Row: {
          is_active: boolean
          key: string
          sort_order: number
        }
        Insert: {
          is_active?: boolean
          key: string
          sort_order: number
        }
        Update: {
          is_active?: boolean
          key?: string
          sort_order?: number
        }
        Relationships: []
      }
      user_consents: {
        Row: {
          granted: boolean
          id: string
          kind: string
          recorded_at: string
          source: string
          user_id: string
          version: string
        }
        Insert: {
          granted: boolean
          id?: string
          kind: string
          recorded_at?: string
          source: string
          user_id: string
          version: string
        }
        Update: {
          granted?: boolean
          id?: string
          kind?: string
          recorded_at?: string
          source?: string
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_kind_fkey"
            columns: ["kind"]
            isOneToOne: false
            referencedRelation: "consent_documents"
            referencedColumns: ["kind"]
          },
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          role: string
          user_id: string
        }
        Insert: {
          role?: string
          user_id: string
        }
        Update: {
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          full_name: string
          id: string
          locale: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          locale?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          locale?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

