package bridge

import (
	"database/sql"

	"github.com/spearson78/fsql"
	"github.com/spearson78/migrate"
)

var migrated = false

func applyMigrations(db *sql.DB) (err error) {

	if migrated {
		return nil
	}
	migrated = true

	return migrate.Apply(db, []migrate.Migration{
		{Id: "createRepositoryTable", Migration: createRepositoryTable},
		{Id: "createAuthorizedKeysTable", Migration: createAuthorizedKeysTable},
		{Id: "createRepositoryPermissionTable", Migration: createRepositoryPermissionTable},
		{Id: "createSinceTable", Migration: createSinceTable},
		{Id: "createRepositoryPushPolicyTable", Migration: createRepositoryPushPolicyTable},
		{Id: "createRepositoryPushPaymentTable", Migration: createRepositoryPushPaymentTable},
		{Id: "createRepositoryPushPaymentIntentTable", Migration: createRepositoryPushPaymentIntentTable},
	})
}

func createRepositoryTable(tx *sql.Tx) error {

	_, err := fsql.Exec(tx, "CREATE TABLE Repository (OwnerPubKey TEXT,RepositoryName TEXT,PublicRead INTEGER,PublicWrite INTEGER,UpdatedAt INTEGER, PRIMARY KEY (OwnerPubKey,RepositoryName))")
	return err
}

func createAuthorizedKeysTable(tx *sql.Tx) error {

	_, err := fsql.Exec(tx, "CREATE TABLE AuthorizedKeys (PubKey TEXT,SshKey TEXT,UpdatedAt INTEGER, PRIMARY KEY (PubKey))")
	return err
}

func createRepositoryPermissionTable(tx *sql.Tx) error {

	_, err := fsql.Exec(tx, "CREATE TABLE RepositoryPermission (OwnerPubKey TEXT,RepositoryName TEXT,TargetPubKey TEXT,Permission TEXT,UpdatedAt INTEGER, PRIMARY KEY (OwnerPubKey,RepositoryName,TargetPubKey))")
	return err
}

func createSinceTable(tx *sql.Tx) error {

	_, err := fsql.Exec(tx, "CREATE TABLE Since (Kind INTEGER,UpdatedAt INTEGER, PRIMARY KEY (Kind))")
	return err
}

func createRepositoryPushPolicyTable(tx *sql.Tx) error {

	_, err := fsql.Exec(tx, "CREATE TABLE RepositoryPushPolicy (OwnerPubKey TEXT,RepositoryName TEXT,PushCostSats INTEGER,UpdatedAt INTEGER, PRIMARY KEY (OwnerPubKey,RepositoryName))")
	return err
}

func createRepositoryPushPaymentTable(tx *sql.Tx) error {

	_, err := fsql.Exec(tx, "CREATE TABLE RepositoryPushPayment (OwnerPubKey TEXT,RepositoryName TEXT,PayerPubKey TEXT,PaidUntil INTEGER,UpdatedAt INTEGER, PRIMARY KEY (OwnerPubKey,RepositoryName,PayerPubKey))")
	return err
}

func createRepositoryPushPaymentIntentTable(tx *sql.Tx) error {

	_, err := fsql.Exec(tx, "CREATE TABLE RepositoryPushPaymentIntent (IntentId TEXT,OwnerPubKey TEXT,RepositoryName TEXT,PayerPubKey TEXT,PushCostSats INTEGER,Invoice TEXT,PaymentHash TEXT,Status TEXT,ExpiresAt INTEGER,CreatedAt INTEGER,UpdatedAt INTEGER,PaidAt INTEGER, PRIMARY KEY (IntentId))")
	if err != nil {
		return err
	}
	_, err = fsql.Exec(tx, "CREATE INDEX idx_repo_push_payment_intent_lookup ON RepositoryPushPaymentIntent (OwnerPubKey,RepositoryName,PayerPubKey,Status,UpdatedAt)")
	return err
}
