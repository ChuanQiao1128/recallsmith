using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Infrastructure.Core.EfCore.Extensions
{
    /// <summary>
    /// 为未引用 Npgsql 扩展时，提供一个等价的 UseXminAsConcurrencyToken。
    /// 将 Postgres 系统列 xmin 映射为并发标记（uint）。
    /// </summary>
    public static class EntityTypeBuilderXminExtensions
    {
        public static EntityTypeBuilder<TEntity> UseXminAsConcurrencyToken<TEntity>(
            this EntityTypeBuilder<TEntity> entity)
            where TEntity : class
        {
            entity.Property<uint>("xmin")
                  .HasColumnName("xmin")
                  .ValueGeneratedOnAddOrUpdate()
                  .IsConcurrencyToken();

            return entity;
        }
    }
}
