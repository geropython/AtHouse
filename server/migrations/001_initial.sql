CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_empty CHECK (length(email) > 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS households (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_memberships (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  nickname text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_nickname_for_member CHECK (role = 'admin' OR nickname IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS membership_nickname_unique
  ON household_memberships (lower(nickname))
  WHERE nickname IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'verify_email' CHECK (purpose IN ('verify_email', 'password_reset')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_invitations (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS household_invitations_pending
  ON household_invitations (household_id, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS temporary_access_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('member_login', 'admin_2fa')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS temporary_access_codes_active
  ON temporary_access_codes (user_id, purpose, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS user_authentication_methods (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_otp_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  pending_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_auth_state CHECK (user_id IS NULL OR pending_user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action text NOT NULL,
  key_hash text NOT NULL,
  attempts integer NOT NULL,
  window_started_at timestamptz NOT NULL,
  PRIMARY KEY (action, key_hash)
);

CREATE TABLE IF NOT EXISTS shopping_items (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  product text NOT NULL CHECK (length(trim(product)) BETWEEN 1 AND 80),
  brand text NOT NULL DEFAULT '',
  price numeric(14, 2) NOT NULL CHECK (price >= 0),
  priority text NOT NULL CHECK (priority IN ('alta', 'media', 'baja')),
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, household_id)
);

CREATE INDEX IF NOT EXISTS shopping_items_by_household
  ON shopping_items (household_id, created_at DESC);

CREATE TABLE IF NOT EXISTS calendar_assignments (
  item_id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  scheduled_date date NOT NULL,
  expires_at date NOT NULL,
  FOREIGN KEY (item_id, household_id)
    REFERENCES shopping_items(id, household_id) ON DELETE CASCADE,
  CHECK (expires_at >= scheduled_date)
);

CREATE TABLE IF NOT EXISTS home_events (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date NOT NULL,
  expires_at date NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed')),
  is_scheduled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (expires_at >= end_date)
);

ALTER TABLE home_events
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS home_events_by_household
  ON home_events (household_id, start_date);
