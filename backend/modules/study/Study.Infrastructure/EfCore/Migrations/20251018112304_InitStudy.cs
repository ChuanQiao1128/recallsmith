using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Study.Infrastructure.EfCore.Migrations
{
    /// <inheritdoc />
    public partial class InitStudy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "study");

            migrationBuilder.CreateTable(
                name: "user_cards",
                schema: "study",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserDeckId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceCardId = table.Column<Guid>(type: "uuid", nullable: false),
                    StableUid = table.Column<string>(type: "text", nullable: false),
                    ContentHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_cards", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "user_decks",
                schema: "study",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CatalogDeckId = table.Column<Guid>(type: "uuid", nullable: false),
                    Version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AppliedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now() at time zone 'utc'"),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_decks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_user_cards_UserDeckId_SourceCardId",
                schema: "study",
                table: "user_cards",
                columns: new[] { "UserDeckId", "SourceCardId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_user_decks_UserId_CatalogDeckId",
                schema: "study",
                table: "user_decks",
                columns: new[] { "UserId", "CatalogDeckId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_cards",
                schema: "study");

            migrationBuilder.DropTable(
                name: "user_decks",
                schema: "study");
        }
    }
}
