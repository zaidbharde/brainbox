package com.rndevil.devilbrowser

import androidx.room.InvalidationTracker
import androidx.room.RoomOpenDelegate
import androidx.room.migration.AutoMigrationSpec
import androidx.room.migration.Migration
import androidx.room.util.TableInfo
import androidx.room.util.TableInfo.Companion.read
import androidx.room.util.dropFtsSyncTriggers
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.execSQL
import javax.`annotation`.processing.Generated
import kotlin.Lazy
import kotlin.String
import kotlin.Suppress
import kotlin.collections.List
import kotlin.collections.Map
import kotlin.collections.MutableList
import kotlin.collections.MutableMap
import kotlin.collections.MutableSet
import kotlin.collections.Set
import kotlin.collections.mutableListOf
import kotlin.collections.mutableMapOf
import kotlin.collections.mutableSetOf
import kotlin.reflect.KClass

@Generated(value = ["androidx.room.RoomProcessor"])
@Suppress(names = ["UNCHECKED_CAST", "DEPRECATION", "REDUNDANT_PROJECTION", "REMOVAL"])
public class AppDatabase_Impl : AppDatabase() {
  private val _browserDao: Lazy<BrowserDao> = lazy {
    BrowserDao_Impl(this)
  }


  protected override fun createOpenDelegate(): RoomOpenDelegate {
    val _openDelegate: RoomOpenDelegate = object : RoomOpenDelegate(7,
        "ec3379c21172dad4ec503a315d4040c6", "2f852efb6e5634f7809faaa16f1d5cc6") {
      public override fun createAllTables(connection: SQLiteConnection) {
        connection.execSQL("CREATE TABLE IF NOT EXISTS `history` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `title` TEXT NOT NULL, `url` TEXT NOT NULL, `timestamp` INTEGER NOT NULL)")
        connection.execSQL("CREATE TABLE IF NOT EXISTS `bookmarks` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `title` TEXT NOT NULL, `url` TEXT NOT NULL, `timestamp` INTEGER NOT NULL)")
        connection.execSQL("CREATE TABLE IF NOT EXISTS `tabs` (`id` TEXT NOT NULL, `url` TEXT NOT NULL, `title` TEXT NOT NULL, `isDesktopMode` INTEGER NOT NULL, `timestamp` INTEGER NOT NULL, PRIMARY KEY(`id`))")
        connection.execSQL("CREATE TABLE IF NOT EXISTS `trash` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `fileName` TEXT NOT NULL, `originalPath` TEXT NOT NULL, `trashPath` TEXT NOT NULL, `size` INTEGER NOT NULL, `mimeType` TEXT, `deletedTimestamp` INTEGER NOT NULL)")
        connection.execSQL("CREATE TABLE IF NOT EXISTS `downloads` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `url` TEXT NOT NULL, `fileName` TEXT NOT NULL, `mimeType` TEXT, `totalSize` INTEGER NOT NULL, `downloadedSize` INTEGER NOT NULL, `speed` INTEGER NOT NULL, `status` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `filePath` TEXT NOT NULL, `category` TEXT NOT NULL)")
        connection.execSQL("CREATE TABLE IF NOT EXISTS room_master_table (id INTEGER PRIMARY KEY,identity_hash TEXT)")
        connection.execSQL("INSERT OR REPLACE INTO room_master_table (id,identity_hash) VALUES(42, 'ec3379c21172dad4ec503a315d4040c6')")
      }

      public override fun dropAllTables(connection: SQLiteConnection) {
        connection.execSQL("DROP TABLE IF EXISTS `history`")
        connection.execSQL("DROP TABLE IF EXISTS `bookmarks`")
        connection.execSQL("DROP TABLE IF EXISTS `tabs`")
        connection.execSQL("DROP TABLE IF EXISTS `trash`")
        connection.execSQL("DROP TABLE IF EXISTS `downloads`")
      }

      public override fun onCreate(connection: SQLiteConnection) {
      }

      public override fun onOpen(connection: SQLiteConnection) {
        internalInitInvalidationTracker(connection)
      }

      public override fun onPreMigrate(connection: SQLiteConnection) {
        dropFtsSyncTriggers(connection)
      }

      public override fun onPostMigrate(connection: SQLiteConnection) {
      }

      public override fun onValidateSchema(connection: SQLiteConnection):
          RoomOpenDelegate.ValidationResult {
        val _columnsHistory: MutableMap<String, TableInfo.Column> = mutableMapOf()
        _columnsHistory.put("id", TableInfo.Column("id", "INTEGER", true, 1, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsHistory.put("title", TableInfo.Column("title", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsHistory.put("url", TableInfo.Column("url", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsHistory.put("timestamp", TableInfo.Column("timestamp", "INTEGER", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        val _foreignKeysHistory: MutableSet<TableInfo.ForeignKey> = mutableSetOf()
        val _indicesHistory: MutableSet<TableInfo.Index> = mutableSetOf()
        val _infoHistory: TableInfo = TableInfo("history", _columnsHistory, _foreignKeysHistory,
            _indicesHistory)
        val _existingHistory: TableInfo = read(connection, "history")
        if (!_infoHistory.equals(_existingHistory)) {
          return RoomOpenDelegate.ValidationResult(false, """
              |history(com.rndevil.devilbrowser.HistoryItem).
              | Expected:
              |""".trimMargin() + _infoHistory + """
              |
              | Found:
              |""".trimMargin() + _existingHistory)
        }
        val _columnsBookmarks: MutableMap<String, TableInfo.Column> = mutableMapOf()
        _columnsBookmarks.put("id", TableInfo.Column("id", "INTEGER", true, 1, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsBookmarks.put("title", TableInfo.Column("title", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsBookmarks.put("url", TableInfo.Column("url", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsBookmarks.put("timestamp", TableInfo.Column("timestamp", "INTEGER", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        val _foreignKeysBookmarks: MutableSet<TableInfo.ForeignKey> = mutableSetOf()
        val _indicesBookmarks: MutableSet<TableInfo.Index> = mutableSetOf()
        val _infoBookmarks: TableInfo = TableInfo("bookmarks", _columnsBookmarks,
            _foreignKeysBookmarks, _indicesBookmarks)
        val _existingBookmarks: TableInfo = read(connection, "bookmarks")
        if (!_infoBookmarks.equals(_existingBookmarks)) {
          return RoomOpenDelegate.ValidationResult(false, """
              |bookmarks(com.rndevil.devilbrowser.BookmarkItem).
              | Expected:
              |""".trimMargin() + _infoBookmarks + """
              |
              | Found:
              |""".trimMargin() + _existingBookmarks)
        }
        val _columnsTabs: MutableMap<String, TableInfo.Column> = mutableMapOf()
        _columnsTabs.put("id", TableInfo.Column("id", "TEXT", true, 1, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTabs.put("url", TableInfo.Column("url", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTabs.put("title", TableInfo.Column("title", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTabs.put("isDesktopMode", TableInfo.Column("isDesktopMode", "INTEGER", true, 0,
            null, TableInfo.CREATED_FROM_ENTITY))
        _columnsTabs.put("timestamp", TableInfo.Column("timestamp", "INTEGER", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        val _foreignKeysTabs: MutableSet<TableInfo.ForeignKey> = mutableSetOf()
        val _indicesTabs: MutableSet<TableInfo.Index> = mutableSetOf()
        val _infoTabs: TableInfo = TableInfo("tabs", _columnsTabs, _foreignKeysTabs, _indicesTabs)
        val _existingTabs: TableInfo = read(connection, "tabs")
        if (!_infoTabs.equals(_existingTabs)) {
          return RoomOpenDelegate.ValidationResult(false, """
              |tabs(com.rndevil.devilbrowser.TabItem).
              | Expected:
              |""".trimMargin() + _infoTabs + """
              |
              | Found:
              |""".trimMargin() + _existingTabs)
        }
        val _columnsTrash: MutableMap<String, TableInfo.Column> = mutableMapOf()
        _columnsTrash.put("id", TableInfo.Column("id", "INTEGER", true, 1, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTrash.put("fileName", TableInfo.Column("fileName", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTrash.put("originalPath", TableInfo.Column("originalPath", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTrash.put("trashPath", TableInfo.Column("trashPath", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTrash.put("size", TableInfo.Column("size", "INTEGER", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTrash.put("mimeType", TableInfo.Column("mimeType", "TEXT", false, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsTrash.put("deletedTimestamp", TableInfo.Column("deletedTimestamp", "INTEGER", true,
            0, null, TableInfo.CREATED_FROM_ENTITY))
        val _foreignKeysTrash: MutableSet<TableInfo.ForeignKey> = mutableSetOf()
        val _indicesTrash: MutableSet<TableInfo.Index> = mutableSetOf()
        val _infoTrash: TableInfo = TableInfo("trash", _columnsTrash, _foreignKeysTrash,
            _indicesTrash)
        val _existingTrash: TableInfo = read(connection, "trash")
        if (!_infoTrash.equals(_existingTrash)) {
          return RoomOpenDelegate.ValidationResult(false, """
              |trash(com.rndevil.devilbrowser.TrashItem).
              | Expected:
              |""".trimMargin() + _infoTrash + """
              |
              | Found:
              |""".trimMargin() + _existingTrash)
        }
        val _columnsDownloads: MutableMap<String, TableInfo.Column> = mutableMapOf()
        _columnsDownloads.put("id", TableInfo.Column("id", "INTEGER", true, 1, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("url", TableInfo.Column("url", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("fileName", TableInfo.Column("fileName", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("mimeType", TableInfo.Column("mimeType", "TEXT", false, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("totalSize", TableInfo.Column("totalSize", "INTEGER", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("downloadedSize", TableInfo.Column("downloadedSize", "INTEGER", true,
            0, null, TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("speed", TableInfo.Column("speed", "INTEGER", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("status", TableInfo.Column("status", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("createdAt", TableInfo.Column("createdAt", "INTEGER", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("filePath", TableInfo.Column("filePath", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        _columnsDownloads.put("category", TableInfo.Column("category", "TEXT", true, 0, null,
            TableInfo.CREATED_FROM_ENTITY))
        val _foreignKeysDownloads: MutableSet<TableInfo.ForeignKey> = mutableSetOf()
        val _indicesDownloads: MutableSet<TableInfo.Index> = mutableSetOf()
        val _infoDownloads: TableInfo = TableInfo("downloads", _columnsDownloads,
            _foreignKeysDownloads, _indicesDownloads)
        val _existingDownloads: TableInfo = read(connection, "downloads")
        if (!_infoDownloads.equals(_existingDownloads)) {
          return RoomOpenDelegate.ValidationResult(false, """
              |downloads(com.rndevil.devilbrowser.DownloadTask).
              | Expected:
              |""".trimMargin() + _infoDownloads + """
              |
              | Found:
              |""".trimMargin() + _existingDownloads)
        }
        return RoomOpenDelegate.ValidationResult(true, null)
      }
    }
    return _openDelegate
  }

  protected override fun createInvalidationTracker(): InvalidationTracker {
    val _shadowTablesMap: MutableMap<String, String> = mutableMapOf()
    val _viewTables: MutableMap<String, Set<String>> = mutableMapOf()
    return InvalidationTracker(this, _shadowTablesMap, _viewTables, "history", "bookmarks", "tabs",
        "trash", "downloads")
  }

  public override fun clearAllTables() {
    super.performClear(false, "history", "bookmarks", "tabs", "trash", "downloads")
  }

  protected override fun getRequiredTypeConverterClasses(): Map<KClass<*>, List<KClass<*>>> {
    val _typeConvertersMap: MutableMap<KClass<*>, List<KClass<*>>> = mutableMapOf()
    _typeConvertersMap.put(BrowserDao::class, BrowserDao_Impl.getRequiredConverters())
    return _typeConvertersMap
  }

  public override fun getRequiredAutoMigrationSpecClasses(): Set<KClass<out AutoMigrationSpec>> {
    val _autoMigrationSpecsSet: MutableSet<KClass<out AutoMigrationSpec>> = mutableSetOf()
    return _autoMigrationSpecsSet
  }

  public override
      fun createAutoMigrations(autoMigrationSpecs: Map<KClass<out AutoMigrationSpec>, AutoMigrationSpec>):
      List<Migration> {
    val _autoMigrations: MutableList<Migration> = mutableListOf()
    return _autoMigrations
  }

  public override fun browserDao(): BrowserDao = _browserDao.value
}
