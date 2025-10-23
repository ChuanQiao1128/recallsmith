using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Authoring.Infrastructure.EfCore.Migrations
{
    /// <inheritdoc />
    public partial class MapDateToEpochMs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "authoring_decks",
                type: "TEXT COLLATE NOCASE",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldMaxLength: 200);

            migrationBuilder.AlterColumn<string>(
                name: "Slug",
                table: "authoring_decks",
                type: "TEXT COLLATE NOCASE",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "TEXT",
                oldMaxLength: 100);

            migrationBuilder.CreateIndex(
                name: "IX_authoring_decks_Title",
                table: "authoring_decks",
                column: "Title");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_authoring_decks_Title",
                table: "authoring_decks");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "authoring_decks",
                type: "TEXT",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "TEXT COLLATE NOCASE",
                oldMaxLength: 200);

            migrationBuilder.AlterColumn<string>(
                name: "Slug",
                table: "authoring_decks",
                type: "TEXT",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "TEXT COLLATE NOCASE",
                oldMaxLength: 200);
        }
    }
}
