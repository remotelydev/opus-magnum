# Database schema

Source of truth: `migrations/` (`001_init.sql`, `002_settings.sql`). PostgreSQL 16.

```mermaid
erDiagram
    sites ||--o{ staff_sites : "has"
    staff ||--o{ staff_sites : "works at"
    staff ||--o{ schedules : "working hours / absences"
    sites ||--o{ schedules : "at"
    staff ||--o{ appointments : "sees"
    sites ||--o{ appointments : "at"
    patients ||--o{ appointments : "books"
    services ||--o{ appointments : "for"
    users ||--o{ appointments : "created by"
    users ||--o{ sessions : "logged in"
    staff |o--o| users : "login of"
    users ||--o{ audit_log : "did"
    sites ||--o{ opening_hours : "open"
    sites ||--o{ opening_exceptions : "holidays"
    staff ||--o{ work_patterns : "weekly pattern"

    sites {
        text id PK "turek, poddebice"
        text name
    }
    staff {
        serial id PK
        text name
        text kind "person | calendar"
        text title "stanowisko"
        text phone
        text email
        bool active
        int sort_order
    }
    staff_sites {
        int staff_id PK, FK
        text site_id PK, FK
    }
    users {
        serial id PK
        text login UK
        text name
        text role "admin | reception | doctor"
        text password_hash "scrypt"
        int staff_id FK "optional"
        bool active
    }
    sessions {
        text token_hash PK "sha256 of the token"
        int user_id FK
        timestamptz expires_at
    }
    services {
        serial id PK
        text category
        text name
        text description
        int duration_minutes
        numeric price_min
        numeric price_max
        text price_note
        bool show_online "on the website"
        int sort_order
        bool active
    }
    patients {
        serial id PK
        text first_name
        text last_name
        text phone "E.164"
        text email
        date birth_date
        text_array medical_flags
        text notes
        bool sms_consent
    }
    schedules {
        serial id PK
        int staff_id FK
        text site_id FK
        timestamptz starts_at
        timestamptz ends_at
        text kind "work | absence"
    }
    appointments {
        serial id PK
        text site_id FK
        int staff_id FK
        int patient_id FK "null = block"
        int service_id FK "null = off price list"
        text title
        timestamptz starts_at
        timestamptz ends_at
        text status "booked | confirmed | cancelled | no_show | done"
        text source "desk | bot | import"
        text notes
        int created_by FK
    }
    audit_log {
        bigserial id PK
        timestamptz at
        int user_id FK
        text action
        text entity
        text entity_id
        jsonb changes
    }
    opening_hours {
        text site_id PK, FK
        smallint weekday PK "1 = Monday ... 7 = Sunday"
        time opens "clinic time"
        time closes
    }
    opening_exceptions {
        text site_id PK, FK
        date day PK
        time opens "null = closed"
        time closes
        text note
    }
    work_patterns {
        serial id PK
        int staff_id FK
        smallint weekday
        text site_id FK
        time starts
        time ends
    }
    import_refs {
        text source PK
        text entity PK
        text source_id PK
        int entity_id
    }
```

Rules the database enforces:
- `appointments_no_overlap`: one staff member cannot have two live appointments at once (cancelled and no-show do not count).
- `price_max >= price_min`, `ends_at > starts_at`, durations above zero.
- Opening hours and work patterns are clinic-local times (Europe/Warsaw); a weekday without an `opening_hours` row is closed.
- `work_patterns` is the template; `schedules` holds the actual blocks the calendar shows. Generating from the pattern rewrites only `work` blocks, never absences.
- `import_refs` is used only by a one-off data import, so it can run again without duplicates. The app never reads it; it can be dropped after the move.
