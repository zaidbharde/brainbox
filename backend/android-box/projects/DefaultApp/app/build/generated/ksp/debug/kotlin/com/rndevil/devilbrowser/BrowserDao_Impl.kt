package com.rndevil.devilbrowser

import androidx.room.EntityDeleteOrUpdateAdapter
import androidx.room.EntityInsertAdapter
import androidx.room.RoomDatabase
import androidx.room.coroutines.createFlow
import androidx.room.util.appendPlaceholders
import androidx.room.util.getColumnIndexOrThrow
import androidx.room.util.performSuspending
import androidx.sqlite.SQLiteStatement
import javax.`annotation`.processing.Generated
import kotlin.Boolean
import kotlin.IllegalArgumentException
import kotlin.Int
import kotlin.Long
import kotlin.String
import kotlin.Suppress
import kotlin.Unit
import kotlin.collections.List
import kotlin.collections.MutableList
import kotlin.collections.mutableListOf
import kotlin.reflect.KClass
import kotlin.text.StringBuilder
import kotlinx.coroutines.flow.Flow

@Generated(value = ["androidx.room.RoomProcessor"])
@Suppress(names = ["UNCHECKED_CAST", "DEPRECATION", "REDUNDANT_PROJECTION", "REMOVAL"])
public class BrowserDao_Impl(
  __db: RoomDatabase,
) : BrowserDao {
  private val __db: RoomDatabase

  private val __insertAdapterOfHistoryItem: EntityInsertAdapter<HistoryItem>

  private val __insertAdapterOfBookmarkItem: EntityInsertAdapter<BookmarkItem>

  private val __insertAdapterOfTabItem: EntityInsertAdapter<TabItem>

  private val __insertAdapterOfTrashItem: EntityInsertAdapter<TrashItem>

  private val __insertAdapterOfDownloadTask: EntityInsertAdapter<DownloadTask>

  private val __deleteAdapterOfHistoryItem: EntityDeleteOrUpdateAdapter<HistoryItem>

  private val __deleteAdapterOfBookmarkItem: EntityDeleteOrUpdateAdapter<BookmarkItem>

  private val __deleteAdapterOfTrashItem: EntityDeleteOrUpdateAdapter<TrashItem>

  private val __deleteAdapterOfDownloadTask: EntityDeleteOrUpdateAdapter<DownloadTask>

  private val __updateAdapterOfDownloadTask: EntityDeleteOrUpdateAdapter<DownloadTask>
  init {
    this.__db = __db
    this.__insertAdapterOfHistoryItem = object : EntityInsertAdapter<HistoryItem>() {
      protected override fun createQuery(): String =
          "INSERT OR REPLACE INTO `history` (`id`,`title`,`url`,`timestamp`) VALUES (nullif(?, 0),?,?,?)"

      protected override fun bind(statement: SQLiteStatement, entity: HistoryItem) {
        statement.bindLong(1, entity.id)
        statement.bindText(2, entity.title)
        statement.bindText(3, entity.url)
        statement.bindLong(4, entity.timestamp)
      }
    }
    this.__insertAdapterOfBookmarkItem = object : EntityInsertAdapter<BookmarkItem>() {
      protected override fun createQuery(): String =
          "INSERT OR REPLACE INTO `bookmarks` (`id`,`title`,`url`,`timestamp`) VALUES (nullif(?, 0),?,?,?)"

      protected override fun bind(statement: SQLiteStatement, entity: BookmarkItem) {
        statement.bindLong(1, entity.id)
        statement.bindText(2, entity.title)
        statement.bindText(3, entity.url)
        statement.bindLong(4, entity.timestamp)
      }
    }
    this.__insertAdapterOfTabItem = object : EntityInsertAdapter<TabItem>() {
      protected override fun createQuery(): String =
          "INSERT OR REPLACE INTO `tabs` (`id`,`url`,`title`,`isDesktopMode`,`timestamp`) VALUES (?,?,?,?,?)"

      protected override fun bind(statement: SQLiteStatement, entity: TabItem) {
        statement.bindText(1, entity.id)
        statement.bindText(2, entity.url)
        statement.bindText(3, entity.title)
        val _tmp: Int = if (entity.isDesktopMode) 1 else 0
        statement.bindLong(4, _tmp.toLong())
        statement.bindLong(5, entity.timestamp)
      }
    }
    this.__insertAdapterOfTrashItem = object : EntityInsertAdapter<TrashItem>() {
      protected override fun createQuery(): String =
          "INSERT OR REPLACE INTO `trash` (`id`,`fileName`,`originalPath`,`trashPath`,`size`,`mimeType`,`deletedTimestamp`) VALUES (nullif(?, 0),?,?,?,?,?,?)"

      protected override fun bind(statement: SQLiteStatement, entity: TrashItem) {
        statement.bindLong(1, entity.id)
        statement.bindText(2, entity.fileName)
        statement.bindText(3, entity.originalPath)
        statement.bindText(4, entity.trashPath)
        statement.bindLong(5, entity.size)
        val _tmpMimeType: String? = entity.mimeType
        if (_tmpMimeType == null) {
          statement.bindNull(6)
        } else {
          statement.bindText(6, _tmpMimeType)
        }
        statement.bindLong(7, entity.deletedTimestamp)
      }
    }
    this.__insertAdapterOfDownloadTask = object : EntityInsertAdapter<DownloadTask>() {
      protected override fun createQuery(): String =
          "INSERT OR REPLACE INTO `downloads` (`id`,`url`,`fileName`,`mimeType`,`totalSize`,`downloadedSize`,`speed`,`status`,`createdAt`,`filePath`,`category`) VALUES (nullif(?, 0),?,?,?,?,?,?,?,?,?,?)"

      protected override fun bind(statement: SQLiteStatement, entity: DownloadTask) {
        statement.bindLong(1, entity.id)
        statement.bindText(2, entity.url)
        statement.bindText(3, entity.fileName)
        val _tmpMimeType: String? = entity.mimeType
        if (_tmpMimeType == null) {
          statement.bindNull(4)
        } else {
          statement.bindText(4, _tmpMimeType)
        }
        statement.bindLong(5, entity.totalSize)
        statement.bindLong(6, entity.downloadedSize)
        statement.bindLong(7, entity.speed)
        statement.bindText(8, __TaskStatus_enumToString(entity.status))
        statement.bindLong(9, entity.createdAt)
        statement.bindText(10, entity.filePath)
        statement.bindText(11, entity.category)
      }
    }
    this.__deleteAdapterOfHistoryItem = object : EntityDeleteOrUpdateAdapter<HistoryItem>() {
      protected override fun createQuery(): String = "DELETE FROM `history` WHERE `id` = ?"

      protected override fun bind(statement: SQLiteStatement, entity: HistoryItem) {
        statement.bindLong(1, entity.id)
      }
    }
    this.__deleteAdapterOfBookmarkItem = object : EntityDeleteOrUpdateAdapter<BookmarkItem>() {
      protected override fun createQuery(): String = "DELETE FROM `bookmarks` WHERE `id` = ?"

      protected override fun bind(statement: SQLiteStatement, entity: BookmarkItem) {
        statement.bindLong(1, entity.id)
      }
    }
    this.__deleteAdapterOfTrashItem = object : EntityDeleteOrUpdateAdapter<TrashItem>() {
      protected override fun createQuery(): String = "DELETE FROM `trash` WHERE `id` = ?"

      protected override fun bind(statement: SQLiteStatement, entity: TrashItem) {
        statement.bindLong(1, entity.id)
      }
    }
    this.__deleteAdapterOfDownloadTask = object : EntityDeleteOrUpdateAdapter<DownloadTask>() {
      protected override fun createQuery(): String = "DELETE FROM `downloads` WHERE `id` = ?"

      protected override fun bind(statement: SQLiteStatement, entity: DownloadTask) {
        statement.bindLong(1, entity.id)
      }
    }
    this.__updateAdapterOfDownloadTask = object : EntityDeleteOrUpdateAdapter<DownloadTask>() {
      protected override fun createQuery(): String =
          "UPDATE OR ABORT `downloads` SET `id` = ?,`url` = ?,`fileName` = ?,`mimeType` = ?,`totalSize` = ?,`downloadedSize` = ?,`speed` = ?,`status` = ?,`createdAt` = ?,`filePath` = ?,`category` = ? WHERE `id` = ?"

      protected override fun bind(statement: SQLiteStatement, entity: DownloadTask) {
        statement.bindLong(1, entity.id)
        statement.bindText(2, entity.url)
        statement.bindText(3, entity.fileName)
        val _tmpMimeType: String? = entity.mimeType
        if (_tmpMimeType == null) {
          statement.bindNull(4)
        } else {
          statement.bindText(4, _tmpMimeType)
        }
        statement.bindLong(5, entity.totalSize)
        statement.bindLong(6, entity.downloadedSize)
        statement.bindLong(7, entity.speed)
        statement.bindText(8, __TaskStatus_enumToString(entity.status))
        statement.bindLong(9, entity.createdAt)
        statement.bindText(10, entity.filePath)
        statement.bindText(11, entity.category)
        statement.bindLong(12, entity.id)
      }
    }
  }

  public override suspend fun insertHistory(item: HistoryItem): Unit = performSuspending(__db,
      false, true) { _connection ->
    __insertAdapterOfHistoryItem.insert(_connection, item)
  }

  public override suspend fun insertBookmark(item: BookmarkItem): Unit = performSuspending(__db,
      false, true) { _connection ->
    __insertAdapterOfBookmarkItem.insert(_connection, item)
  }

  public override suspend fun insertTab(item: TabItem): Unit = performSuspending(__db, false, true)
      { _connection ->
    __insertAdapterOfTabItem.insert(_connection, item)
  }

  public override suspend fun insertTrash(item: TrashItem): Unit = performSuspending(__db, false,
      true) { _connection ->
    __insertAdapterOfTrashItem.insert(_connection, item)
  }

  public override suspend fun insertDownload(task: DownloadTask): Long = performSuspending(__db,
      false, true) { _connection ->
    val _result: Long = __insertAdapterOfDownloadTask.insertAndReturnId(_connection, task)
    _result
  }

  public override suspend fun deleteHistory(item: HistoryItem): Unit = performSuspending(__db,
      false, true) { _connection ->
    __deleteAdapterOfHistoryItem.handle(_connection, item)
  }

  public override suspend fun deleteBookmark(item: BookmarkItem): Unit = performSuspending(__db,
      false, true) { _connection ->
    __deleteAdapterOfBookmarkItem.handle(_connection, item)
  }

  public override suspend fun deleteTrashItem(item: TrashItem): Unit = performSuspending(__db,
      false, true) { _connection ->
    __deleteAdapterOfTrashItem.handle(_connection, item)
  }

  public override suspend fun deleteDownload(task: DownloadTask): Unit = performSuspending(__db,
      false, true) { _connection ->
    __deleteAdapterOfDownloadTask.handle(_connection, task)
  }

  public override suspend fun updateDownload(task: DownloadTask): Unit = performSuspending(__db,
      false, true) { _connection ->
    __updateAdapterOfDownloadTask.handle(_connection, task)
  }

  public override fun getAllHistory(): Flow<List<HistoryItem>> {
    val _sql: String = "SELECT * FROM history ORDER BY timestamp DESC"
    return createFlow(__db, false, arrayOf("history")) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        val _cursorIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _cursorIndexOfTitle: Int = getColumnIndexOrThrow(_stmt, "title")
        val _cursorIndexOfUrl: Int = getColumnIndexOrThrow(_stmt, "url")
        val _cursorIndexOfTimestamp: Int = getColumnIndexOrThrow(_stmt, "timestamp")
        val _result: MutableList<HistoryItem> = mutableListOf()
        while (_stmt.step()) {
          val _item: HistoryItem
          val _tmpId: Long
          _tmpId = _stmt.getLong(_cursorIndexOfId)
          val _tmpTitle: String
          _tmpTitle = _stmt.getText(_cursorIndexOfTitle)
          val _tmpUrl: String
          _tmpUrl = _stmt.getText(_cursorIndexOfUrl)
          val _tmpTimestamp: Long
          _tmpTimestamp = _stmt.getLong(_cursorIndexOfTimestamp)
          _item = HistoryItem(_tmpId,_tmpTitle,_tmpUrl,_tmpTimestamp)
          _result.add(_item)
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override fun getAllBookmarks(): Flow<List<BookmarkItem>> {
    val _sql: String = "SELECT * FROM bookmarks ORDER BY timestamp DESC"
    return createFlow(__db, false, arrayOf("bookmarks")) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        val _cursorIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _cursorIndexOfTitle: Int = getColumnIndexOrThrow(_stmt, "title")
        val _cursorIndexOfUrl: Int = getColumnIndexOrThrow(_stmt, "url")
        val _cursorIndexOfTimestamp: Int = getColumnIndexOrThrow(_stmt, "timestamp")
        val _result: MutableList<BookmarkItem> = mutableListOf()
        while (_stmt.step()) {
          val _item: BookmarkItem
          val _tmpId: Long
          _tmpId = _stmt.getLong(_cursorIndexOfId)
          val _tmpTitle: String
          _tmpTitle = _stmt.getText(_cursorIndexOfTitle)
          val _tmpUrl: String
          _tmpUrl = _stmt.getText(_cursorIndexOfUrl)
          val _tmpTimestamp: Long
          _tmpTimestamp = _stmt.getLong(_cursorIndexOfTimestamp)
          _item = BookmarkItem(_tmpId,_tmpTitle,_tmpUrl,_tmpTimestamp)
          _result.add(_item)
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun isBookmarked(url: String): Boolean {
    val _sql: String = "SELECT EXISTS(SELECT * FROM bookmarks WHERE url = ?)"
    return performSuspending(__db, true, false) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindText(_argIndex, url)
        val _result: Boolean
        if (_stmt.step()) {
          val _tmp: Int
          _tmp = _stmt.getLong(0).toInt()
          _result = _tmp != 0
        } else {
          _result = false
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun getAllTabs(): List<TabItem> {
    val _sql: String = "SELECT * FROM tabs ORDER BY timestamp ASC"
    return performSuspending(__db, true, false) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        val _cursorIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _cursorIndexOfUrl: Int = getColumnIndexOrThrow(_stmt, "url")
        val _cursorIndexOfTitle: Int = getColumnIndexOrThrow(_stmt, "title")
        val _cursorIndexOfIsDesktopMode: Int = getColumnIndexOrThrow(_stmt, "isDesktopMode")
        val _cursorIndexOfTimestamp: Int = getColumnIndexOrThrow(_stmt, "timestamp")
        val _result: MutableList<TabItem> = mutableListOf()
        while (_stmt.step()) {
          val _item: TabItem
          val _tmpId: String
          _tmpId = _stmt.getText(_cursorIndexOfId)
          val _tmpUrl: String
          _tmpUrl = _stmt.getText(_cursorIndexOfUrl)
          val _tmpTitle: String
          _tmpTitle = _stmt.getText(_cursorIndexOfTitle)
          val _tmpIsDesktopMode: Boolean
          val _tmp: Int
          _tmp = _stmt.getLong(_cursorIndexOfIsDesktopMode).toInt()
          _tmpIsDesktopMode = _tmp != 0
          val _tmpTimestamp: Long
          _tmpTimestamp = _stmt.getLong(_cursorIndexOfTimestamp)
          _item = TabItem(_tmpId,_tmpUrl,_tmpTitle,_tmpIsDesktopMode,_tmpTimestamp)
          _result.add(_item)
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override fun getAllTrashItems(): Flow<List<TrashItem>> {
    val _sql: String = "SELECT * FROM trash ORDER BY deletedTimestamp DESC"
    return createFlow(__db, false, arrayOf("trash")) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        val _cursorIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _cursorIndexOfFileName: Int = getColumnIndexOrThrow(_stmt, "fileName")
        val _cursorIndexOfOriginalPath: Int = getColumnIndexOrThrow(_stmt, "originalPath")
        val _cursorIndexOfTrashPath: Int = getColumnIndexOrThrow(_stmt, "trashPath")
        val _cursorIndexOfSize: Int = getColumnIndexOrThrow(_stmt, "size")
        val _cursorIndexOfMimeType: Int = getColumnIndexOrThrow(_stmt, "mimeType")
        val _cursorIndexOfDeletedTimestamp: Int = getColumnIndexOrThrow(_stmt, "deletedTimestamp")
        val _result: MutableList<TrashItem> = mutableListOf()
        while (_stmt.step()) {
          val _item: TrashItem
          val _tmpId: Long
          _tmpId = _stmt.getLong(_cursorIndexOfId)
          val _tmpFileName: String
          _tmpFileName = _stmt.getText(_cursorIndexOfFileName)
          val _tmpOriginalPath: String
          _tmpOriginalPath = _stmt.getText(_cursorIndexOfOriginalPath)
          val _tmpTrashPath: String
          _tmpTrashPath = _stmt.getText(_cursorIndexOfTrashPath)
          val _tmpSize: Long
          _tmpSize = _stmt.getLong(_cursorIndexOfSize)
          val _tmpMimeType: String?
          if (_stmt.isNull(_cursorIndexOfMimeType)) {
            _tmpMimeType = null
          } else {
            _tmpMimeType = _stmt.getText(_cursorIndexOfMimeType)
          }
          val _tmpDeletedTimestamp: Long
          _tmpDeletedTimestamp = _stmt.getLong(_cursorIndexOfDeletedTimestamp)
          _item =
              TrashItem(_tmpId,_tmpFileName,_tmpOriginalPath,_tmpTrashPath,_tmpSize,_tmpMimeType,_tmpDeletedTimestamp)
          _result.add(_item)
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override fun getAllDownloads(): Flow<List<DownloadTask>> {
    val _sql: String = "SELECT * FROM downloads ORDER BY createdAt DESC"
    return createFlow(__db, false, arrayOf("downloads")) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        val _cursorIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _cursorIndexOfUrl: Int = getColumnIndexOrThrow(_stmt, "url")
        val _cursorIndexOfFileName: Int = getColumnIndexOrThrow(_stmt, "fileName")
        val _cursorIndexOfMimeType: Int = getColumnIndexOrThrow(_stmt, "mimeType")
        val _cursorIndexOfTotalSize: Int = getColumnIndexOrThrow(_stmt, "totalSize")
        val _cursorIndexOfDownloadedSize: Int = getColumnIndexOrThrow(_stmt, "downloadedSize")
        val _cursorIndexOfSpeed: Int = getColumnIndexOrThrow(_stmt, "speed")
        val _cursorIndexOfStatus: Int = getColumnIndexOrThrow(_stmt, "status")
        val _cursorIndexOfCreatedAt: Int = getColumnIndexOrThrow(_stmt, "createdAt")
        val _cursorIndexOfFilePath: Int = getColumnIndexOrThrow(_stmt, "filePath")
        val _cursorIndexOfCategory: Int = getColumnIndexOrThrow(_stmt, "category")
        val _result: MutableList<DownloadTask> = mutableListOf()
        while (_stmt.step()) {
          val _item: DownloadTask
          val _tmpId: Long
          _tmpId = _stmt.getLong(_cursorIndexOfId)
          val _tmpUrl: String
          _tmpUrl = _stmt.getText(_cursorIndexOfUrl)
          val _tmpFileName: String
          _tmpFileName = _stmt.getText(_cursorIndexOfFileName)
          val _tmpMimeType: String?
          if (_stmt.isNull(_cursorIndexOfMimeType)) {
            _tmpMimeType = null
          } else {
            _tmpMimeType = _stmt.getText(_cursorIndexOfMimeType)
          }
          val _tmpTotalSize: Long
          _tmpTotalSize = _stmt.getLong(_cursorIndexOfTotalSize)
          val _tmpDownloadedSize: Long
          _tmpDownloadedSize = _stmt.getLong(_cursorIndexOfDownloadedSize)
          val _tmpSpeed: Long
          _tmpSpeed = _stmt.getLong(_cursorIndexOfSpeed)
          val _tmpStatus: TaskStatus
          _tmpStatus = __TaskStatus_stringToEnum(_stmt.getText(_cursorIndexOfStatus))
          val _tmpCreatedAt: Long
          _tmpCreatedAt = _stmt.getLong(_cursorIndexOfCreatedAt)
          val _tmpFilePath: String
          _tmpFilePath = _stmt.getText(_cursorIndexOfFilePath)
          val _tmpCategory: String
          _tmpCategory = _stmt.getText(_cursorIndexOfCategory)
          _item =
              DownloadTask(_tmpId,_tmpUrl,_tmpFileName,_tmpMimeType,_tmpTotalSize,_tmpDownloadedSize,_tmpSpeed,_tmpStatus,_tmpCreatedAt,_tmpFilePath,_tmpCategory)
          _result.add(_item)
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun getDownloadById(id: Long): DownloadTask? {
    val _sql: String = "SELECT * FROM downloads WHERE id = ?"
    return performSuspending(__db, true, false) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindLong(_argIndex, id)
        val _cursorIndexOfId: Int = getColumnIndexOrThrow(_stmt, "id")
        val _cursorIndexOfUrl: Int = getColumnIndexOrThrow(_stmt, "url")
        val _cursorIndexOfFileName: Int = getColumnIndexOrThrow(_stmt, "fileName")
        val _cursorIndexOfMimeType: Int = getColumnIndexOrThrow(_stmt, "mimeType")
        val _cursorIndexOfTotalSize: Int = getColumnIndexOrThrow(_stmt, "totalSize")
        val _cursorIndexOfDownloadedSize: Int = getColumnIndexOrThrow(_stmt, "downloadedSize")
        val _cursorIndexOfSpeed: Int = getColumnIndexOrThrow(_stmt, "speed")
        val _cursorIndexOfStatus: Int = getColumnIndexOrThrow(_stmt, "status")
        val _cursorIndexOfCreatedAt: Int = getColumnIndexOrThrow(_stmt, "createdAt")
        val _cursorIndexOfFilePath: Int = getColumnIndexOrThrow(_stmt, "filePath")
        val _cursorIndexOfCategory: Int = getColumnIndexOrThrow(_stmt, "category")
        val _result: DownloadTask?
        if (_stmt.step()) {
          val _tmpId: Long
          _tmpId = _stmt.getLong(_cursorIndexOfId)
          val _tmpUrl: String
          _tmpUrl = _stmt.getText(_cursorIndexOfUrl)
          val _tmpFileName: String
          _tmpFileName = _stmt.getText(_cursorIndexOfFileName)
          val _tmpMimeType: String?
          if (_stmt.isNull(_cursorIndexOfMimeType)) {
            _tmpMimeType = null
          } else {
            _tmpMimeType = _stmt.getText(_cursorIndexOfMimeType)
          }
          val _tmpTotalSize: Long
          _tmpTotalSize = _stmt.getLong(_cursorIndexOfTotalSize)
          val _tmpDownloadedSize: Long
          _tmpDownloadedSize = _stmt.getLong(_cursorIndexOfDownloadedSize)
          val _tmpSpeed: Long
          _tmpSpeed = _stmt.getLong(_cursorIndexOfSpeed)
          val _tmpStatus: TaskStatus
          _tmpStatus = __TaskStatus_stringToEnum(_stmt.getText(_cursorIndexOfStatus))
          val _tmpCreatedAt: Long
          _tmpCreatedAt = _stmt.getLong(_cursorIndexOfCreatedAt)
          val _tmpFilePath: String
          _tmpFilePath = _stmt.getText(_cursorIndexOfFilePath)
          val _tmpCategory: String
          _tmpCategory = _stmt.getText(_cursorIndexOfCategory)
          _result =
              DownloadTask(_tmpId,_tmpUrl,_tmpFileName,_tmpMimeType,_tmpTotalSize,_tmpDownloadedSize,_tmpSpeed,_tmpStatus,_tmpCreatedAt,_tmpFilePath,_tmpCategory)
        } else {
          _result = null
        }
        _result
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun deleteHistoryItems(ids: List<Long>) {
    val _stringBuilder: StringBuilder = StringBuilder()
    _stringBuilder.append("DELETE FROM history WHERE id IN (")
    val _inputSize: Int = ids.size
    appendPlaceholders(_stringBuilder, _inputSize)
    _stringBuilder.append(")")
    val _sql: String = _stringBuilder.toString()
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        for (_item: Long in ids) {
          _stmt.bindLong(_argIndex, _item)
          _argIndex++
        }
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun clearAllHistory() {
    val _sql: String = "DELETE FROM history"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun removeBookmarkByUrl(url: String) {
    val _sql: String = "DELETE FROM bookmarks WHERE url = ?"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindText(_argIndex, url)
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun deleteTabById(id: String) {
    val _sql: String = "DELETE FROM tabs WHERE id = ?"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindText(_argIndex, id)
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun clearAllTabs() {
    val _sql: String = "DELETE FROM tabs"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun clearAllTrash() {
    val _sql: String = "DELETE FROM trash"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun autoDeleteOldTrash(expiry: Long) {
    val _sql: String = "DELETE FROM trash WHERE deletedTimestamp < ?"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindLong(_argIndex, expiry)
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  public override suspend fun updateDownloadProgress(
    id: Long,
    downloadedSize: Long,
    speed: Long,
  ) {
    val _sql: String = "UPDATE downloads SET downloadedSize = ?, speed = ? WHERE id = ?"
    return performSuspending(__db, false, true) { _connection ->
      val _stmt: SQLiteStatement = _connection.prepare(_sql)
      try {
        var _argIndex: Int = 1
        _stmt.bindLong(_argIndex, downloadedSize)
        _argIndex = 2
        _stmt.bindLong(_argIndex, speed)
        _argIndex = 3
        _stmt.bindLong(_argIndex, id)
        _stmt.step()
      } finally {
        _stmt.close()
      }
    }
  }

  private fun __TaskStatus_enumToString(_value: TaskStatus): String = when (_value) {
    TaskStatus.PENDING -> "PENDING"
    TaskStatus.DOWNLOADING -> "DOWNLOADING"
    TaskStatus.PAUSED -> "PAUSED"
    TaskStatus.COMPLETED -> "COMPLETED"
    TaskStatus.FAILED -> "FAILED"
    TaskStatus.CANCELLED -> "CANCELLED"
  }

  private fun __TaskStatus_stringToEnum(_value: String): TaskStatus = when (_value) {
    "PENDING" -> TaskStatus.PENDING
    "DOWNLOADING" -> TaskStatus.DOWNLOADING
    "PAUSED" -> TaskStatus.PAUSED
    "COMPLETED" -> TaskStatus.COMPLETED
    "FAILED" -> TaskStatus.FAILED
    "CANCELLED" -> TaskStatus.CANCELLED
    else -> throw IllegalArgumentException("Can't convert value to enum, unknown value: " + _value)
  }

  public companion object {
    public fun getRequiredConverters(): List<KClass<*>> = emptyList()
  }
}
