---
name: sql-cambio
description: Use when a change needs new tables, columns, indexes, views or data fixes in the Azure SQL database shared by Portal_Mensajeria and Bot_Mensajeria. Covers where the script goes and how to write it.
---

# Cambios de base de datos

1. Nunca ejecutar el script ni crear `.sql` en el repo. Agregarlo **al final** de `D:\SQL Scripts\Bot_Mensajeria.sql` (Read del archivo y Edit/Write agregando abajo; no tocar lo anterior).
2. Formato:

```sql
-- ============================================================================
-- [AAAA-MM-DD] Qué agrega y para qué (Portal_Mensajeria | Bot_Mensajeria)
-- ============================================================================
IF OBJECT_ID('dbo.Tabla', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Tabla (
    id INT IDENTITY(1,1) PRIMARY KEY,
    clienteId INT NOT NULL REFERENCES dbo.Clientes(id),
    ...
    fechaAlta DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO
IF COL_LENGTH('dbo.Tabla', 'columna') IS NULL
  ALTER TABLE dbo.Tabla ADD columna NVARCHAR(100) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Tabla_columna')
  CREATE INDEX IX_Tabla_columna ON dbo.Tabla(clienteId, columna);
GO
```

3. Reglas: idempotente siempre; `GO` después de cada `ALTER ... ADD` antes de usar la columna; columnas nuevas `NULL` o con `DEFAULT` (hay datos y el bot sigue escribiendo); fechas `DATETIME2` UTC; tablas por Cliente con `clienteId` FK; no borrar ni renombrar columnas que use el bot.
4. Para saber tipos/tamaños reales sin tocar nada: query de solo lectura a `INFORMATION_SCHEMA.COLUMNS` con un script node en el scratchpad (`require('<repo>/node_modules/dotenv').config({ path: '<repo>/.env' })` + `mssql`).
5. Al terminar, decirle al usuario: qué bloque agregar/correr y si hay que correrlo **antes de deployar**.
