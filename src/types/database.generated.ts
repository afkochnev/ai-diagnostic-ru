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
      ai_reports: {
        Row: {
          completed_at: string | null
          created_at: string
          diagnostic_id: string
          error_code: string | null
          error_message: string | null
          id: string
          input_hash: string
          input_snapshot: Json
          model: string
          prompt_version: string
          provider_request_id: string | null
          schema_version: string
          status: string
          structured_content: Json | null
          version: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          diagnostic_id: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_hash: string
          input_snapshot: Json
          model: string
          prompt_version: string
          provider_request_id?: string | null
          schema_version: string
          status: string
          structured_content?: Json | null
          version: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          diagnostic_id?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          input_hash?: string
          input_snapshot?: Json
          model?: string
          prompt_version?: string
          provider_request_id?: string | null
          schema_version?: string
          status?: string
          structured_content?: Json | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_reports_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id"]
          },
        ]
      }
      answers: {
        Row: {
          created_at: string
          diagnostic_id: string
          id: string
          numeric_value: number | null
          question_id: string
          revision: number
          text_value: string | null
          updated_at: string
          version_id: string
        }
        Insert: {
          created_at?: string
          diagnostic_id: string
          id?: string
          numeric_value?: number | null
          question_id: string
          revision?: number
          text_value?: string | null
          updated_at?: string
          version_id: string
        }
        Update: {
          created_at?: string
          diagnostic_id?: string
          id?: string
          numeric_value?: number | null
          question_id?: string
          revision?: number
          text_value?: string | null
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answers_diagnostic_id_version_id_fkey"
            columns: ["diagnostic_id", "version_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id", "version_id"]
          },
          {
            foreignKeyName: "answers_question_id_version_id_fkey"
            columns: ["question_id", "version_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id", "version_id"]
          },
          {
            foreignKeyName: "answers_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_versions"
            referencedColumns: ["id"]
          },
        ]
      }
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
      consultation_notification_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          job_id: string
          last_error_code: string | null
          last_error_message: string | null
          lead_request_id: string
          provider: string
          provider_message_id: string | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          job_id: string
          last_error_code?: string | null
          last_error_message?: string | null
          lead_request_id: string
          provider?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          job_id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lead_request_id?: string
          provider?: string
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_notification_deliveries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_notification_deliveries_lead_request_id_fkey"
            columns: ["lead_request_id"]
            isOneToOne: true
            referencedRelation: "lead_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_block_results: {
        Row: {
          block_id: string
          created_at: string
          display_score: number
          id: string
          question_count: number
          raw_score: number
          result_id: string
          version_id: string
        }
        Insert: {
          block_id: string
          created_at?: string
          display_score: number
          id?: string
          question_count: number
          raw_score: number
          result_id: string
          version_id: string
        }
        Update: {
          block_id?: string
          created_at?: string
          display_score?: number
          id?: string
          question_count?: number
          raw_score?: number
          result_id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_block_results_block_id_version_id_fkey"
            columns: ["block_id", "version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_blocks"
            referencedColumns: ["id", "version_id"]
          },
          {
            foreignKeyName: "diagnostic_block_results_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_results"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_block_translations: {
        Row: {
          block_id: string
          description: string | null
          locale: string
          title: string
        }
        Insert: {
          block_id: string
          description?: string | null
          locale: string
          title: string
        }
        Update: {
          block_id?: string
          description?: string | null
          locale?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_block_translations_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_blocks: {
        Row: {
          id: string
          is_active: boolean
          key: string
          position: number
          version_id: string
          weight: number
        }
        Insert: {
          id?: string
          is_active?: boolean
          key: string
          position: number
          version_id: string
          weight: number
        }
        Update: {
          id?: string
          is_active?: boolean
          key?: string
          position?: number
          version_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_blocks_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_company_snapshots: {
        Row: {
          captured_at: string
          company_id: string
          diagnostic_id: string
          profile_data: Json
          profile_revision: number
        }
        Insert: {
          captured_at?: string
          company_id: string
          diagnostic_id: string
          profile_data: Json
          profile_revision: number
        }
        Update: {
          captured_at?: string
          company_id?: string
          diagnostic_id?: string
          profile_data?: Json
          profile_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_company_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_company_snapshots_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: true
            referencedRelation: "diagnostics"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_definitions: {
        Row: {
          created_at: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      diagnostic_mutations: {
        Row: {
          created_at: string
          diagnostic_id: string
          id: string
          mutation_id: string
          resulting_revision: number
        }
        Insert: {
          created_at?: string
          diagnostic_id: string
          id?: string
          mutation_id: string
          resulting_revision: number
        }
        Update: {
          created_at?: string
          diagnostic_id?: string
          id?: string
          mutation_id?: string
          resulting_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_mutations_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_results: {
        Row: {
          calculation_version: string
          created_at: string
          diagnostic_id: string
          display_manageability_index: number
          id: string
          input_hash: string
          maturity_level_id: string | null
          raw_manageability_index: number
          version_id: string
        }
        Insert: {
          calculation_version: string
          created_at?: string
          diagnostic_id: string
          display_manageability_index: number
          id?: string
          input_hash: string
          maturity_level_id?: string | null
          raw_manageability_index: number
          version_id: string
        }
        Update: {
          calculation_version?: string
          created_at?: string
          diagnostic_id?: string
          display_manageability_index?: number
          id?: string
          input_hash?: string
          maturity_level_id?: string | null
          raw_manageability_index?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_results_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: true
            referencedRelation: "diagnostics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostic_results_diagnostic_id_version_id_fkey"
            columns: ["diagnostic_id", "version_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id", "version_id"]
          },
          {
            foreignKeyName: "diagnostic_results_maturity_level_id_fkey"
            columns: ["maturity_level_id"]
            isOneToOne: false
            referencedRelation: "maturity_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_version_translations: {
        Row: {
          description: string | null
          locale: string
          title: string
          version_id: string
        }
        Insert: {
          description?: string | null
          locale: string
          title: string
          version_id: string
        }
        Update: {
          description?: string | null
          locale?: string
          title?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_version_translations_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostic_versions: {
        Row: {
          content_hash: string
          definition_id: string
          id: string
          published_at: string | null
          source_file: string
          status: string
          version_number: number
        }
        Insert: {
          content_hash: string
          definition_id: string
          id?: string
          published_at?: string | null
          source_file: string
          status: string
          version_number: number
        }
        Update: {
          content_hash?: string
          definition_id?: string
          id?: string
          published_at?: string | null
          source_file?: string
          status?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "diagnostic_versions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      diagnostics: {
        Row: {
          company_id: string
          completed_at: string | null
          created_by_user_id: string
          current_block_id: string | null
          id: string
          last_saved_at: string
          locale: string
          revision: number
          started_at: string
          status: string
          submitted_at: string | null
          version_id: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_by_user_id: string
          current_block_id?: string | null
          id?: string
          last_saved_at?: string
          locale?: string
          revision?: number
          started_at?: string
          status?: string
          submitted_at?: string | null
          version_id: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_by_user_id?: string
          current_block_id?: string | null
          id?: string
          last_saved_at?: string
          locale?: string
          revision?: number
          started_at?: string
          status?: string
          submitted_at?: string | null
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "diagnostics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostics_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diagnostics_current_block_id_version_id_fkey"
            columns: ["current_block_id", "version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_blocks"
            referencedColumns: ["id", "version_id"]
          },
          {
            foreignKeyName: "diagnostics_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          ai_report_id: string
          ai_report_version: number
          attempt_count: number
          created_at: string
          diagnostic_id: string
          id: string
          last_error_code: string | null
          last_error_message: string | null
          pdf_artifact_id: string
          provider: string
          provider_message_id: string | null
          recipient_email: string
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_report_id: string
          ai_report_version: number
          attempt_count?: number
          created_at?: string
          diagnostic_id: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          pdf_artifact_id: string
          provider: string
          provider_message_id?: string | null
          recipient_email: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_report_id?: string
          ai_report_version?: number
          attempt_count?: number
          created_at?: string
          diagnostic_id?: string
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          pdf_artifact_id?: string
          provider?: string
          provider_message_id?: string | null
          recipient_email?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_ai_report_id_ai_report_version_fkey"
            columns: ["ai_report_id", "ai_report_version"]
            isOneToOne: false
            referencedRelation: "ai_reports"
            referencedColumns: ["id", "version"]
          },
          {
            foreignKeyName: "email_deliveries_ai_report_id_fkey"
            columns: ["ai_report_id"]
            isOneToOne: false
            referencedRelation: "ai_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_pdf_artifact_id_fkey"
            columns: ["pdf_artifact_id"]
            isOneToOne: false
            referencedRelation: "report_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          company_id: string
          created_at: string
          diagnostic_id: string
          id: string
          improve: string | null
          rating: number
          updated_at: string
          useful: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          diagnostic_id: string
          id?: string
          improve?: string | null
          rating: number
          updated_at?: string
          useful?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          diagnostic_id?: string
          id?: string
          improve?: string | null
          rating?: number
          updated_at?: string
          useful?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_diagnostic_id_company_id_fkey"
            columns: ["diagnostic_id", "company_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "feedback_diagnostic_id_user_id_fkey"
            columns: ["diagnostic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id", "created_by_user_id"]
          },
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
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
      jobs: {
        Row: {
          attempts: number
          available_at: string
          completed_at: string | null
          created_at: string
          deduplication_key: string
          diagnostic_id: string
          id: string
          kind: string
          last_error_code: string | null
          last_error_message: string | null
          lease_expires_at: string | null
          lease_token: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          deduplication_key?: string
          diagnostic_id: string
          id?: string
          kind: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          deduplication_key?: string
          diagnostic_id?: string
          id?: string
          kind?: string
          last_error_code?: string | null
          last_error_message?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_diagnostic_id_fkey"
            columns: ["diagnostic_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_requests: {
        Row: {
          comment: string | null
          company_id: string
          contact_type: string | null
          contact_value: string | null
          created_at: string
          diagnostic_id: string
          email: string
          id: string
          idempotency_key: string
          name: string
          report_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          company_id: string
          contact_type?: string | null
          contact_value?: string | null
          created_at?: string
          diagnostic_id: string
          email: string
          id?: string
          idempotency_key: string
          name: string
          report_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          company_id?: string
          contact_type?: string | null
          contact_value?: string | null
          created_at?: string
          diagnostic_id?: string
          email?: string
          id?: string
          idempotency_key?: string
          name?: string
          report_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_requests_diagnostic_id_company_id_fkey"
            columns: ["diagnostic_id", "company_id"]
            isOneToOne: false
            referencedRelation: "diagnostics"
            referencedColumns: ["id", "company_id"]
          },
          {
            foreignKeyName: "lead_requests_report_id_diagnostic_id_fkey"
            columns: ["report_id", "diagnostic_id"]
            isOneToOne: false
            referencedRelation: "ai_reports"
            referencedColumns: ["id", "diagnostic_id"]
          },
          {
            foreignKeyName: "lead_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      maturity_level_translations: {
        Row: {
          description: string | null
          label: string
          locale: string
          maturity_level_id: string
        }
        Insert: {
          description?: string | null
          label: string
          locale: string
          maturity_level_id: string
        }
        Update: {
          description?: string | null
          label?: string
          locale?: string
          maturity_level_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maturity_level_translations_maturity_level_id_fkey"
            columns: ["maturity_level_id"]
            isOneToOne: false
            referencedRelation: "maturity_levels"
            referencedColumns: ["id"]
          },
        ]
      }
      maturity_levels: {
        Row: {
          classification_config: Json
          id: string
          key: string
          position: number
          version_id: string
        }
        Insert: {
          classification_config?: Json
          id?: string
          key: string
          position: number
          version_id: string
        }
        Update: {
          classification_config?: Json
          id?: string
          key?: string
          position?: number
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maturity_levels_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_option_translations: {
        Row: {
          label: string
          locale: string
          option_id: string
        }
        Insert: {
          label: string
          locale: string
          option_id: string
        }
        Update: {
          label?: string
          locale?: string
          option_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_option_translations_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "question_options"
            referencedColumns: ["id"]
          },
        ]
      }
      question_options: {
        Row: {
          id: string
          key: string
          position: number
          question_id: string
          score_value: number
        }
        Insert: {
          id?: string
          key: string
          position: number
          question_id: string
          score_value: number
        }
        Update: {
          id?: string
          key?: string
          position?: number
          question_id?: string
          score_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_translations: {
        Row: {
          help_text: string | null
          locale: string
          prompt: string
          question_id: string
        }
        Insert: {
          help_text?: string | null
          locale: string
          prompt: string
          question_id: string
        }
        Update: {
          help_text?: string | null
          locale?: string
          prompt?: string
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_translations_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          answer_type: string
          block_id: string
          id: string
          is_active: boolean
          is_required: boolean
          key: string
          legacy_ai_context_label: string | null
          legacy_bubble_unique_id: string | null
          position: number
          reverse_score: boolean
          version_id: string
          weight: number
        }
        Insert: {
          answer_type: string
          block_id: string
          id?: string
          is_active?: boolean
          is_required: boolean
          key: string
          legacy_ai_context_label?: string | null
          legacy_bubble_unique_id?: string | null
          position: number
          reverse_score?: boolean
          version_id: string
          weight: number
        }
        Update: {
          answer_type?: string
          block_id?: string
          id?: string
          is_active?: boolean
          is_required?: boolean
          key?: string
          legacy_ai_context_label?: string | null
          legacy_bubble_unique_id?: string | null
          position?: number
          reverse_score?: boolean
          version_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "questions_block_id_version_id_fkey"
            columns: ["block_id", "version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_blocks"
            referencedColumns: ["id", "version_id"]
          },
          {
            foreignKeyName: "questions_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "diagnostic_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_artifacts: {
        Row: {
          ai_report_version: number
          checksum: string
          content_base64: string
          format: string
          generated_at: string
          id: string
          report_id: string
          status: string
          storage_path: string
          template_version: string
        }
        Insert: {
          ai_report_version: number
          checksum: string
          content_base64: string
          format: string
          generated_at?: string
          id?: string
          report_id: string
          status: string
          storage_path: string
          template_version: string
        }
        Update: {
          ai_report_version?: number
          checksum?: string
          content_base64?: string
          format?: string
          generated_at?: string
          id?: string
          report_id?: string
          status?: string
          storage_path?: string
          template_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_artifacts_report_id_ai_report_version_fkey"
            columns: ["report_id", "ai_report_version"]
            isOneToOne: false
            referencedRelation: "ai_reports"
            referencedColumns: ["id", "version"]
          },
          {
            foreignKeyName: "report_artifacts_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "ai_reports"
            referencedColumns: ["id"]
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
      scoring_policies: {
        Row: {
          configuration: Json
          engine_key: string
          engine_version: string
          id: string
          policy_hash: string
          schema_version: string
          version_id: string
        }
        Insert: {
          configuration?: Json
          engine_key: string
          engine_version: string
          id?: string
          policy_hash: string
          schema_version: string
          version_id: string
        }
        Update: {
          configuration?: Json
          engine_key?: string
          engine_version?: string
          id?: string
          policy_hash?: string
          schema_version?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scoring_policies_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: true
            referencedRelation: "diagnostic_versions"
            referencedColumns: ["id"]
          },
        ]
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
      save_diagnostic_block: {
        Args: {
          p_answers?: Json
          p_answers_dirty?: boolean
          p_current_block_id: string
          p_diagnostic_id: string
          p_expected_revision: number
          p_mutation_id: string
        }
        Returns: {
          current_block_id: string
          revision: number
        }[]
      }
      claim_consultation_notification_jobs: {
        Args: { p_limit?: number; p_max_attempts?: number; p_lease_seconds?: number }
        Returns: {
          attempt_count: number
          job_id: string
          lead_request_id: string
          lease_token: string
        }[]
      }
      claim_scoring_jobs: {
        Args: { p_limit?: number; p_max_attempts?: number; p_lease_seconds?: number }
        Returns: {
          attempt_count: number
          deduplication_key: string
          diagnostic_id: string
          job_id: string
          lease_token: string
        }[]
      }
      claim_ai_report_jobs: {
        Args: { p_limit?: number; p_max_attempts?: number; p_lease_seconds?: number }
        Returns: {
          attempt_count: number
          deduplication_key: string
          diagnostic_id: string
          job_id: string
          lease_token: string
        }[]
      }
      create_feedback: {
        Args: {
          p_diagnostic_id: string
          p_improve: string
          p_rating: number
          p_useful: string
        }
        Returns: Json
      }
      create_lead_request: {
        Args: {
          p_comment: string
          p_contact_type: string
          p_contact_value: string
          p_diagnostic_id: string
          p_idempotency_key: string
          p_name: string
          p_report_id: string
        }
        Returns: Json
      }
      submit_diagnostic: {
        Args: { p_diagnostic_id: string; p_expected_revision: number }
        Returns: Json
      }
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
