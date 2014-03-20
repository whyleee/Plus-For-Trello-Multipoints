var g_db = null;

//thanks to http://blog.maxaller.name/2010/03/html5-web-sql-database-intro-to-versioning-and-migrations/
function Migrator(db, sendResponse) {
	var migrations = [];
	this.migration = function (number, func) {
		migrations[number] = func;
	};
	var doMigration = function (number) {
		if (migrations[number]) {
			db.changeVersion(db.version, String(number), function (t) {
				migrations[number](t);
			}, function (err) {
				if (console.error) console.error("Error!: %o", err);
			}, function () {
				doMigration(number + 1);
			});
		} else {
			handleGetTotalRows(false, sendResponse); //include cRowsTotal
		}
	};

	this.doIt = function () {
		var initialVersion = parseInt(db.version, 10) || 0;
		try {
			doMigration(initialVersion + 1);
		} catch (e) {
			if (console.error)
				console.error(e);
		}
	};
}

function handleInsertHistoryRowFromUI(request, sendResponse) {
	insertIntoDB([request.row], sendResponse);
}

var g_cReadSyncLock = 0;
var g_cWriteSyncLock = 0;

function handleIsSyncing(sendResponse) {
	var response = { status: "OK", bSyncing: (g_cReadSyncLock > 0 || g_cWriteSyncLock > 0) };
	sendResponse(response);
}

function handleGetTotalRows(bOnlyNotSync, sendResponse) {
	var sql = "select count(*) as total FROM HISTORY";
	if (bOnlyNotSync)
		sql += " WHERE bSynced=0";
	var request = { sql: sql, values: [] };
	handleGetReport(request,
		function (response) {
			var thisResponse = { status: response.status };
			if (response.status != "OK") {
				sendResponse(thisResponse);
				return;
			}
			var cRowsTotal = response.rows[0].total;
			thisResponse.cRowsTotal = cRowsTotal;
			sendResponse(thisResponse);
		});
}

function handleGetTotalMessages(sendResponse) {
	var request = { sql: "select count(*) as total FROM LOGMESSAGES", values: [] };
	handleGetReport(request,
		function (response) {
			var thisResponse = { status: response.status };
			if (response.status != "OK") {
				sendResponse(thisResponse);
				return;
			}
			var cRowsTotal = response.rows[0].total;
			thisResponse.cRowsTotal = cRowsTotal;
			sendResponse(thisResponse);
		});
}

function handleSyncDB(request, sendResponseParam) {
	if (g_db == null || g_cReadSyncLock != 0) {
		sendResponseParam({ status: "busy" });
		return;
	}

	var retConfig = request.config;
	if (retConfig === undefined) {
		sendResponseParam({ status: "not configured" });
	}
	else if (retConfig && retConfig.status != "OK") {
		sendResponseParam({ status: retConfig.status });
	}

	if (g_cReadSyncLock < 0) {
		logPlusError("Error: g_cReadSyncLock");
		sendResponseParam({ status: "error." });
		return;
	}

	g_cReadSyncLock++;


	function sendResponse(response) {
		//hook into response to manage locking and write sync
		g_cReadSyncLock--;
		if (retConfig != null && retConfig.spentSpecialUser === undefined && response.status == "OK") {
			if (g_cWriteSyncLock == 0) {
				//increment now instead of startWriteSync so its correct when asking if its syncing 
				g_cWriteSyncLock++;
				setTimeout(function () {
					startWriteSync(retConfig.idSsUser, retConfig.idUserSheetTrello);
				}, 100); //see if we need to write into the spreadsheet, but start a little bit after this response
			}
		}
		else
			g_strLastWriteSyncStatus = "OK"; //reset. happens when user changes google sync setup
		response.statusLastWriteSync = g_strLastWriteSyncStatus;
		sendResponseParam(response);
	}

	if (retConfig == null) {  //simple trello case, pretend a sync happened. this way we follow the same route in simple trello too
		sendResponse({ status: "OK", cRowsNew: 0 });
	}
	else {
		try {
			var idSs = null;
			var idSheet = null;

			if (retConfig.idMasterSheetTrello !== undefined) {
				idSs = retConfig.idSsMaster;
				idSheet = retConfig.idMasterSheetTrello;
			} else {
				idSs = retConfig.idSsUser;
				idSheet = retConfig.idUserSheetTrello;
			}

			var url = "https://spreadsheets.google.com/feeds/list/" +
				idSs + "/" + idSheet +
				"/private/basic";

			var idSsLastSync = localStorage["idSsLastSync"];
			var rowSyncStart = 1;
			var iRowEndLastSpreadsheet = rowSyncStart - 1; //0
			if (idSsLastSync && idSsLastSync == idSs) {
				var rowSyncEndLast = localStorage["rowSsSyncEndLast"];
				if (rowSyncEndLast) {
					iRowEndLastSpreadsheet = parseInt(rowSyncEndLast,10);
					rowSyncStart = iRowEndLastSpreadsheet + 1;
				}
			} else {
				localStorage["rowSsSyncEndLast"] = 0; //detect idssChange so that its automatic on archive+new ss.
				localStorage["idSsLastSync"] = idSs;
			}
			var dataAll = [];
			var cPage = 1000; //get rows by chunks.
			//thanks to https://groups.google.com/forum/#!topic/google-spreadsheets-api/dSniiF18xnM
			var params = { 'alt': 'json', 'start-index': rowSyncStart, 'max-results': cPage };
			handleApiCall(url, params, true, function myCallback(resp) {
				try {
					if (resp !== undefined && resp.data !== undefined && resp.data.feed !== undefined) {
						var entry = resp.data.feed.entry;
						if (entry === undefined || entry.length == 0) {
							processNewRows(dataAll, sendResponse, iRowEndLastSpreadsheet);
							return;
						}
						var data = entry;
						var iData = 0;
						for (; iData < data.length; iData++)
							dataAll.push(data[iData]);
						if (entry.length < cPage) {
							processNewRows(dataAll, sendResponse, iRowEndLastSpreadsheet);
							return;
						}

						rowSyncStart += cPage;
						var paramsNew = { 'alt': 'json', 'start-index': rowSyncStart, 'max-results': cPage };
						handleApiCall(url, paramsNew, true, myCallback);

					} else {
						sendResponse({ status: resp.status });
					}
				} catch (e) {
					sendResponse({ status: "exception: " + e.message });
				}
			}
			);
		} catch (e) {
			sendResponse({ status: "exception: " + e.message });
		}
	}
}

var g_strLastWriteSyncStatus = "OK";

function startWriteSync(idSsUser, idUserSheetTrello) {
	if (g_cWriteSyncLock != 1) {
		logPlusError("bad g_cWriteSyncLock"); //should never happen
		g_cWriteSyncLock--;
		return;
	}

	var request = {
		sql: "select H.idHistory, H.date, C.idBoard, C.idCard, B.name as board, C.name as card, H.spent, H.est, H.user, H.week, H.month, H.comment \
				FROM HISTORY H JOIN CARDS C on H.idCard=C.idCard JOIN BOARDS B ON C.idBoard=B.idBoard \
				where H.bSynced=0 order by H.date ASC", values: []
	};
	handleGetReport(request,
		function (response) {
			if (response.status == "OK")
				appendRowsToSpreadsheet(response.rows, 0, idSsUser, idUserSheetTrello, function () { g_cWriteSyncLock--; });
			else {
				g_strLastWriteSyncStatus = response.status;
				g_cWriteSyncLock--;
			}

		});
}

function appendRowsToSpreadsheet(rows, iRow, idSsUser, idUserSheetTrello, response) {
	if (rows.length == iRow) {
		if (rows.length == 0)
			g_strLastWriteSyncStatus = "OK"; //gets set while writting rows so set it here too for the no-rows case
		response();
		return;
	}
	appendRowToSpreadsheet(rows[iRow], idSsUser, idUserSheetTrello, function () {
		//wait a little per row to not overwhelm quotas
		//note: the only common case where there is more than 1 row to write is when the user firt sets up sync after using Plus without sync.
		//so its not worth it to optimize that case, it will just take longer to complete the write sync.
		//note that it actually takes longer than the timeout, since a row waits for the previous one to finish (serial)
		if (g_strLastWriteSyncStatus != "OK")
			response();
		else
			setTimeout(function () { appendRowsToSpreadsheet(rows, iRow + 1, idSsUser, idUserSheetTrello, response); }, 2000);
	});
}

function dateToSpreadsheetString(date) {
	// M/D/YYYY H:M:S review zig: make it customizable, but its hard given google spreadsheet inability to control its format.
	var year = date.getFullYear();
	var month = date.getMonth() + 1;
	var day = date.getDate();
	var hour = date.getHours();
	var min = date.getMinutes();
	var sec = date.getSeconds();
	var ret = "" + month + "/" + day + "/" + year + " " + hour + ":" + min + ":" + sec;
	return ret;
}

function appendRowToSpreadsheet(row, idSsUser, idUserSheetTrello, sendResponse) {
	var date = new Date(row.date * 1000);
	var atom = makeRowAtom(dateToSpreadsheetString(date), row.board, row.card, row.spent, row.est,
				   row.user, row.week, row.month, row.comment, row.idBoard, row.idCard, row.idHistory);
	var url = "https://spreadsheets.google.com/feeds/list/" + idSsUser + "/" + idUserSheetTrello + "/private/full";
	handleApiCall(url, {}, true, function (response) {
		g_strLastWriteSyncStatus = response.status;
		sendResponse(); //note this serializes all appends, so we dont overwhelm google quotas
	}, atom);
}

function appendLogToPublicSpreadsheet(message, sendResponse) {
	var atom = makeMessageAtom(message);
	var url = "https://spreadsheets.google.com/feeds/list/" + "0AneAYB2jAvLQdHpraGVneGQ3Z2ZjRUtTdVk0ZU5vd2c" + "/" + gid_to_wid(0) + "/private/full";
	handleApiCall(url, {}, true, function (response) {
		sendResponse(); //note this serializes all appends, so we dont overwhelm google quotas
	}, atom);
}

function handleGetReport(request, sendResponse) {
	if (g_db == null) {
		var error = "unusual: db not ready";
		logPlusError(error);
		sendResponse({ status: error });
		return;
	}

	var sql = request.sql;
	var values = request.values;
	var rowsResult = [];
	g_db.transaction(function (tx) {
		tx.executeSql(sql, values,
			function (t, results) {
				var i = 0;
				for (; i < results.rows.length; i++)
					rowsResult.push(results.rows.item(i));
			},
			function (trans, error) {
				logPlusError(error.message + " sql: " + sql);
				return true; //stop
			});
	},

	function errorTransaction() {
		logPlusError("error in handleGetReport: " + sql);
		sendResponse({ status: "ERROR: handleGetReport" });
	},

	function okTransaction() {
		sendResponse({ status: "OK", rows: rowsResult });
	});
}

function parseNewHistoryRow(rowIn) {
	var strContents = rowIn.content.$t;
	var strRegex = "^board:\\s*'?(.*), card:\\s*'?(.*), spenth:\\s*'?(.*), esth:\\s*'?(.*), who:\\s*'?(.*), week:\\s*'?(.*), month:\\s*'?([0-9\\-]*)(, comment:\\s*'?(.*))?, cardurl:\\s*'?(.*), idtrello:\\s*'?(.*)$";
	var patt = new RegExp(strRegex);
	var rgResults = patt.exec(strContents);
	if (rgResults == null)
		throw new Error("Generic parse row error: " + strContents);
	var rgIds = rgResults[11].split("-");
	if (rgIds.length != 3)
		throw new Error("Bad ids parse row error: " + strContents);

	var date = rowIn.title.$t;
	//   1  2  3   4  5  6
	//   7/30/2013 18:15:25
	var pattDate = new RegExp("'?(\\d+)/(\\d+)/(\\d+)\\s(\\d+):(\\d+):(\\d+)");
	var rgResultsDate = pattDate.exec(date);
	if (rgResultsDate == null)
		throw new Error("Generic date parse error: " + date);
	var dateParsed = new Date(rgResultsDate[3], rgResultsDate[1] - 1, rgResultsDate[2], rgResultsDate[4], rgResultsDate[5], rgResultsDate[6], 0);
	var strBoard = cleanupStringSpreadsheet(rgResults[1]);
	var strCard = cleanupStringSpreadsheet(rgResults[2]);
	var spent = parseFloat(rgResults[3]);
	var est = parseFloat(rgResults[4]);
	var user = cleanupStringSpreadsheet(rgResults[5]);
	var week = cleanupStringSpreadsheet(rgResults[6]);
	var month = cleanupStringSpreadsheet(rgResults[7]);
	var comment = "";
	if (rgResults[9] !== undefined)
		comment = cleanupStringSpreadsheet(rgResults[9]);
	var idRow = cleanupStringSpreadsheet(rgIds[0]);
	var idCard = rgIds[1];
	var idBoard = rgIds[2];
	var obj = {};

	obj.idRow = idRow;
	obj.idCard = idCard;
	obj.idBoard = idBoard;
	obj.date = Math.floor(dateParsed.getTime() / 1000); //seconds since 1970
	obj.strBoard = strBoard;
	obj.strCard = strCard;
	obj.spent = spent;
	obj.est = est;
	obj.user = user;
	obj.week = week;
	obj.month = month;
	obj.comment = comment;
	return obj;
}

function cleanupStringSpreadsheet(str) {
	if (typeof (str) != 'string')
		return str;
	str = str.trim();
	if (str.indexOf("'") == 0)
		str = str.substr(1);
	return str;
}

function processNewRows(rowsInput, sendResponse, iRowEndLastSpreadsheet) {

	var rows = [];
	var i = 0;
	for (; i < rowsInput.length; i++) {
		rows.push(parseNewHistoryRow(rowsInput[i]));
	}
	insertIntoDB(rows, sendResponse, iRowEndLastSpreadsheet);

}

function handleCardCreatedUpdatedMoved(rowParam, tx) {
	var row = rowParam; //see "note: its important to explicitly use a local row variable"
	var strExecute = "SELECT idCard, idBoard, name from CARDS where idCard=?";
	var values = [row.idCard];

	tx.executeSql(strExecute, values,
	function onOk(tx2, resultSet) {
		var strExecute2 = null;
		if (resultSet.rows.length > 1)
			logPlusError("cards bad consistency: duplicate card");
		var bCardRenamedOrCreated = false;
		var bCardMoved = false;
		if (resultSet.rows.length > 0) {
			var rowCard = resultSet.rows.item(0);
			if (rowCard.idBoard != row.idBoard)
				bCardMoved = true; //moved

			if (rowCard.name != row.strCard)
				bCardRenamedOrCreated = true; //renamed
		} else
			bCardRenamedOrCreated = true; //created

		if (bCardRenamedOrCreated || bCardMoved) {
			strExecute2 = "INSERT OR REPLACE INTO CARDS (idCard, idBoard, name) \
						   VALUES (? , ? , ?)";
			tx2.executeSql(strExecute2, [row.idCard, row.idBoard, row.strCard], null,
				function (tx3, error) {
					logPlusError(error.message);
					return true; //stop
				});
		}
		if (bCardMoved) {
			//note: the only reason we have an idBoard here is for perf as sqlite doesnt have indexed views.
			//this supports moving cards to another board.
			strExecute2 = "UPDATE HISTORY SET idBoard=? WHERE idCard=?";
			//console.log("idBoard: " + row.idBoard + "  idCard:" + row.idCard);
			tx2.executeSql(strExecute2, [row.idBoard, row.idCard], null,
				function (tx3, error) {
					logPlusError(error.message);
					return true; //stop
				}
			);
		}
	},
	function (tx2, error) {
		logPlusError(error.message);
		return true; //stop
	});
}

function handleUpdateCardBalances(rowParam, idRowParam, tx) {
	var row = rowParam; //see "note: its important to explicitly use a local row variable"
	var strExecute = "INSERT OR IGNORE INTO CARDBALANCE (idCard, user, spent, est, diff, date) VALUES (?, ?, ?, ?, ?, ?)";
	tx.executeSql(strExecute, [row.idCard, row.user, 0, 0, 0, row.date],
		function onOkInsert(tx2, resultSet) {
			var eType = ETYPE_NONE;

			if (resultSet.rowsAffected == 1)
				eType = ETYPE_NEW;
			else if (row.strCard.indexOf(TAG_RECURRING_CARD) >= 0)
				eType = ETYPE_NONE;
			else if (row.est > 0)
				eType = ETYPE_INCR;
			else if (row.est < 0)
				eType = ETYPE_DECR;

			if (eType == ETYPE_NONE)
				return; //skip since the HISTORY row was inserted with ETYPE_NONE

			var strExecute2 = "UPDATE HISTORY SET eType=? WHERE rowid=?";
			tx2.executeSql(strExecute2, [eType, idRowParam],
				null,
				function (tx3, error) {
					logPlusError(error.message);
					return true; //stop
				}
			);
		},
		function (tx3, error) {
			logPlusError(error.message);
			return true; //stop
		}
	);

	strExecute = "UPDATE CARDBALANCE SET spent=spent+?, est=est+?, diff=diff+?, date=max(date,?) WHERE idCard=? AND user=?";
	tx.executeSql(strExecute, [row.spent, row.est, parseFixedFloat(row.est - row.spent), row.date, row.idCard, row.user], null,
		function (tx3, error) {
			logPlusError(error.message);
			return true; //stop
		}
	);
}

var g_lastInsertError = "";

function insertIntoDB(rows, sendResponse, iRowEndLastSpreadsheet) {
	var i = 0;
	var cProcessedTotal = 0;
	var cInsertedTotal = 0;
	var cRows = rows.length;
	var bFromSpreadsheet = (iRowEndLastSpreadsheet !== undefined); //otherwise it comes from the interface

	if (rows.length == 0) {
		sendResponse({ status: "OK", cRowsNew: 0 });
		return;
	}

	function processCurrentRow(tx, rowParam) {
		//note: its important to explicitly use a local row variable so subqueries below will receive the correct row.
		//	  else it will point to the caller's row which is reused in a loop.
		var row = rowParam;

		//in case board is new or changes
		var strExecute = "INSERT OR REPLACE INTO BOARDS (idBoard, name) \
				VALUES (?, ?)";
		tx.executeSql(strExecute, [row.idBoard, row.strBoard], null,
			function (tx2, error) {
				logPlusError(error.message);
				return true; //stop
			});

		strExecute = "INSERT OR IGNORE INTO HISTORY (idHistory, date, idBoard, idCard, spent, est, user, week, month, comment, bSynced, eType) \
				VALUES (? , ? , ? , ? , ? , ? , ? ,? , ?, ?, ?, ?)";
		//note that when writting rows from the UI (not the spreadsheet) we dont set bSynced=1 right away, instead we wait until we read that row from the ss to set it
		var bSynced = (bFromSpreadsheet ? 1 : 0);
		//bSynced arquitecture note: bSynced denotes if the row came from the spreadsheet. When it doesnt come from the ss, it comes from
		//the user interface, which will eventually be written to the ss, and eventually read again and set the 0 into 1 below.
		//eType note: use ETYPE_NONE so later we save a row commit if its really ETYPE_NONE
		tx.executeSql(strExecute, [row.idRow, Math.floor(row.date), row.idBoard, row.idCard, row.spent, row.est, row.user, row.week, row.month, row.comment, bSynced, ETYPE_NONE],
			function onOkInsertHistory(tx2, resultSet) {
				if (resultSet.rowsAffected != 1)
					return; //note that insertId is set to a bogus id in this case. happens when the insert was ignored.
				cInsertedTotal++;
				//see "note: its important to explicitly use a local row variable"
				var rowInner = row;
				//console.log("idBoard history:"+rowInner.idBoard);
				var idRowInner = resultSet.insertId;
				//must do this only when history is created, not updated, thus its in here and not outside the history insert.
				if (rowInner.idCard != ID_PLUSCOMMAND) {
					handleCardCreatedUpdatedMoved(rowInner, tx2);
					handleUpdateCardBalances(rowInner, idRowInner, tx2);
				}
				else
					handlePlusCommand(rowInner, idRowInner, tx2, !bFromSpreadsheet);
			},
			function onError(tx2, error) {
				logPlusError(error.message);
				return true; //stop
			}
		);

		if (bFromSpreadsheet) {
			//review zig: see how to avoid this extra query. happens when row was initially inserted from UI and later synced from ss.
			strExecute = "UPDATE HISTORY SET bSynced=1 WHERE idHistory=? AND bSynced=0";
			tx.executeSql(strExecute, [row.idRow],
				function (tx2, resultSet) { },
				function (tx2, error) {
					logPlusError(error.message);
					return true; //stop
				}
			);
		}
	}

	function processBulkInsert(tx) {
		var step = 500; //avoid a massive transacion (should use less ram i guess). relevant only in first-sync case or reset

		var cRowsMaxLoop = i + step;
		if (cRowsMaxLoop > cRows)
			cRowsMaxLoop = cRows;

		//note about commands: when processing commands, we need to reference data from previous commands (eg [un]markboard)
		//and some of that data is created in secondary handlers, thus the primary handler in the row loop wont see the data as it hasnt
		//been created yet, (being async, primary handlers excute all first, then secondary)
		//thus, in this loop we will break after encountering a 2nd command.
		var cCommands = 0;
		for (; i < cRowsMaxLoop; i++) {
			var rowLoop = rows[i];
			var bCommand = (rowLoop.idCard == ID_PLUSCOMMAND);
			if (bCommand)
				cCommands++;
			if (cCommands > 1)
				break; //dont allow two commands on the same transaction
			if (rowLoop.idRow == "") { //stop on first empty row (though api supposedly never returns empty rows at the end)
				i = cRows; //force stop of toplevel closure
				break;
			}
			cProcessedTotal++;
			processCurrentRow(tx, rowLoop);
		}
	}

	function errorTransaction() {
		logPlusError("error in insertIntoDB");
		var status = g_lastInsertError;

		if (status == "")
			status = "ERROR: insertIntoDB.";
		sendResponse({ status: status });
	}

	function okTransaction() {
		if (iRowEndLastSpreadsheet !== undefined) //undefined when inserting from interface, not spreadsheet
			localStorage["rowSsSyncEndLast"] = iRowEndLastSpreadsheet + cProcessedTotal;
		if (i < cRows) {
			g_db.transaction(processBulkInsert, errorTransaction, okTransaction);
		} else
			sendResponse({ status: "OK", cRowsNew: cInsertedTotal });
	}

	g_lastInsertError = ""; //reset
	g_db.transaction(processBulkInsert, errorTransaction, okTransaction);
}

function handlePlusCommand(rowInnerParam, rowidInner, tx, bThrowErrors) {
	//note on mark balances. defining sums of S/E by history rowid makes it a strict mark that cant be changed with back-reporting (-3d etc)
	var rowInner = rowInnerParam;
	var rowIdHistory = rowidInner;
	var userMarked = rowInner.user;
	var comment = rowInner.comment;
	var idBoard = rowInner.idBoard;
	var date = rowInner.date;
	var patt = /^(\[by ([^ \t\r\n\v\f]+)\][ \t]+)?\^(markboard|unmarkboard)([ \t]+(.*))?/;
	var rgResults = patt.exec(comment);
	if (rgResults == null) {
		logPlusError("bad parameters in Plus command.");
	} else {
		var userMarking = rgResults[2] || userMarked;
		var command = rgResults[3];
		var nameMarker = (rgResults[5] || "").trim();
		var nameMarkerUpper = nameMarker.toUpperCase();


		//note: this is not enforced by unique index, so in far theory there could be a duplicate row inserted
		var strExecute = "SELECT rowid,dateStart,rowidHistoryStart,spentStart,estStart,nameMarker FROM BOARDMARKERS WHERE idBoard=? AND userMarking=? AND userMarked=? AND UPPER(nameMarker)=? AND dateEnd IS NULL";
		tx.executeSql(strExecute, [idBoard, userMarking, userMarked, nameMarkerUpper],
			function (tx2, resultSet) {
				var length = resultSet.rows.length;
				var rowMarker = null;
				if (length > 0)
					rowMarker = resultSet.rows.item(0);

				if (command == "markboard") {
					if (rowMarker != null) {
						g_lastInsertError = "Error: there is already an open marker with that name by you for that user. If you really want to create it use a different name.";
						if (bThrowErrors)
							throw new Error(g_lastInsertError);
						logPlusError(g_lastInsertError);
						return;
					}
					//insert marker
					var strExecute2 = "INSERT INTO BOARDMARKERS (idBoard, dateStart, rowidHistoryStart, spentStart, estStart,\
						dateEnd, rowidHistoryEnd, spentEnd, estEnd, nameMarker, userMarked, userMarking)  \
							SELECT ?, ?, ?, SUM(spent), sum(est), NULL, NULL, NULL, NULL, ?, ?, ? FROM history WHERE idBoard=? AND user=? AND rowid < ?";
					var values2 = [idBoard, date, rowIdHistory, nameMarker, userMarked, userMarking, idBoard, userMarked, rowIdHistory];
					tx2.executeSql(strExecute2, values2,
						function (tx3, resultSet) {
						},
						function (tx3, error) {
							logPlusError(error.message);
							return true; //stop
						}
					);
					return;
				} else if (command == "unmarkboard") {
					if (rowMarker == null) {
						g_lastInsertError = "row with error was ignored: no such open marker with that name to close for that user. row id: " + rowInner.idRow;
						if (bThrowErrors)
							throw new Error(g_lastInsertError); //this really shouldnt happen unless the dashboard was modified from another window
						logPlusError(g_lastInsertError);
						return;
					}
					//close marker  INTO CARDS (idCard, idBoard, name) VALUES (? , ? , ?)
					var strExecute2 = "\
					INSERT OR REPLACE INTO BOARDMARKERS (rowid,idBoard,dateStart,rowidHistoryStart,spentStart,estStart, \
					dateEnd,rowidHistoryEnd,spentEnd,estEnd,nameMarker,userMarked,userMarking) \
					SELECT ?,?,?,?,?,?,?,?,SUM(spent), SUM(est), ?,?,? FROM history WHERE idBoard=? AND user=? AND rowid < ?";
					var values2 = [rowMarker.rowid, idBoard, rowMarker.dateStart, rowMarker.rowidHistoryStart, rowMarker.spentStart, rowMarker.estStart,
									date, rowIdHistory, rowMarker.nameMarker, userMarked, userMarking, idBoard, userMarked, rowIdHistory];
					tx2.executeSql(strExecute2, values2,
						function (tx3, resultSet) {
						},
						function (tx3, error) {
							logPlusError(error.message);
							return true; //stop
						}
					);
					return;
				} else {
					logPlusError("error: unknown plus command.");
				}
			},
			function (tx2, error) {
				logPlusError(error.message);
				return true; //stop
			}
		);
	}
}

function handleDeleteAllLogMessages(request, sendResponse) {
	var db = g_db;
	var ret = { status: "" };
	if (db == null) {
		ret.status = "ERROR: handleDeleteAllLogMessages no g_db";
		logPlusError(ret.status);
		sendResponse(ret);
		return;
	}

	db.transaction(function (tx) {
		var strExecute = "DELETE FROM LOGMESSAGES";
		tx.executeSql(strExecute, []);
	},

	function errorTransaction() {
		ret.status = "Error while deleting logmessages";
		logPlusError(ret.status);
		sendResponse(ret);
		return;
	},

	function okTransaction() {
		ret.status = "OK";
		sendResponse(ret);
		return;
	});
}

function handleDeleteDB(request, sendResponse) {
	var db = g_db;
	if (db == null) {
		sendResponse({ status: "ERROR: handleDeleteDB no g_db" });
		return;
	}
	var versionCur = parseInt(db.version,10) || 0;
	db.changeVersion(versionCur, 0, function (t) {
		//not deleting LOGMESSAGES
		t.executeSql('DROP TABLE IF EXISTS BOARDMARKERS');
		t.executeSql('DROP TABLE IF EXISTS HISTORY');
		t.executeSql('DROP TABLE IF EXISTS CARDBALANCE');
		t.executeSql('DROP TABLE IF EXISTS CARDS');
		t.executeSql('DROP TABLE IF EXISTS BOARDS');


	}, function (err) {
		if (console.error)
			console.error("Error!: %o", err);
		sendResponse({ status: "ERROR: handleDeleteDB" });
	}, function () {
		localStorage["rowSsSyncEndLast"] = 0; //just in case, thou shoud be set also when opening the db on migration 1.
		g_db = null;
		sendResponse({ status: "OK" });
	});
}


function insertLogMessages(log, bWriteToPublicLog, tuser, callback) {
	var ret = { status: "" };
	var db = g_db;
	if (db == null) {
		ret.status = "Error, no db open yet";
		callback(ret);
		return;
	}

	var logLocal = g_plusLogMessages;

	if (log.length == 1 && log[0] == null) { //review zig: temp
		log = [];
		logLocal = [];
	}

	if (logLocal.length == 0 && log.length == 0) {
		ret.status = "OK";
		callback(ret);
		return;
	}

	var rgPostPublicLog = [];
	db.transaction(function (tx) {
		var i = 0;
		var logs = [logLocal, log]; //commit our own log too.
		var j = 0;
		for (; j < logs.length; j++) {
			var logCur = logs[j];
			for (i = 0; i < logCur.length; i++) {
				var entry = logCur[i];
				var strExecute = "INSERT INTO LOGMESSAGES (date, message) \
				VALUES (?, ?)";
				tx.executeSql(strExecute, [Math.round(entry.date / 1000), entry.message]);
				if (bWriteToPublicLog)
					rgPostPublicLog.push(entry.message);
			}
		}
	},

	function errorTransaction() {
		ret.status = "Error while inserting logmessages";
		callback(ret);
		return;
	},

	function okTransaction() {
		g_plusLogMessages = [];
		ret.status = "OK";
		callback(ret);
		if (rgPostPublicLog.length > 0)
			startWritePublicLog(rgPostPublicLog, tuser);
		return;
	});
}

function startWritePublicLog(messages, tuser) {

	function processCurrent(iitem) {
		appendLogToPublicSpreadsheet(tuser+": "+messages[iitem], function () {
			var iitemNew = iitem + 1;
			if (iitemNew == messages.length)
				return;
			setTimeout(function () { processCurrent(iitemNew); }, 2000);
		});
	}
	processCurrent(0);
}

function handleOpenDB(sendResponse) {

	if (g_db != null) {
		handleGetTotalRows(false, sendResponse);
		return;
	}
	var db = openDatabase('trellodata', '', 'Trello database', 20 * 1024 * 1024); //20mb though extension asks for unlimited so it should grow automatically.
	g_db = db; //cache forever
	var versionCur = parseInt(db.version,10) || 0;

	var M = new Migrator(db, sendResponse);
	//note: use SELECT * FROM sqlite_master to list tables and views in the console.
	//review zig: if the migration fails, we dont detect it and never call it again. shouldnt fail but its desastrous if it does.
	//NOTE: remember to update handleDeleteDB and properly use CREATE TABLE [IF NOT EXISTS]
	M.migration(1, function (t) {
		//delete old saved tokens (Before we used chrome.identity)
		var scopeOld = encodeURI("https://spreadsheets.google.com/feeds/");
		delete localStorage["oauth_token" + scopeOld];
		delete localStorage["oauth_token_secret" + scopeOld];

		localStorage["rowSsSyncEndLast"] = 0; //reset when creating database

		t.executeSql('CREATE TABLE BOARDS ( \
							idBoard TEXT PRIMARY KEY  NOT NULL, \
							name TEXT  NOT NULL \
							)');

		//FOREIGN KEY (idBoard) REFERENCES BOARDS(idBoard) not supported by chrome
		t.executeSql('CREATE TABLE CARDS ( \
							idCard TEXT PRIMARY KEY  NOT NULL, \
							idBoard TEXT NOT NULL, \
							name TEXT  NOT NULL \
							)');

		//FOREIGN KEY (idCard) REFERENCES CARDS(idCard) not supported by chrome
		t.executeSql('CREATE TABLE HISTORY ( \
							idHistory TEXT PRIMARY KEY  NOT NULL, \
							date INT   NOT NULL, \
							idBoard TEXT NOT NULL, \
							idCard TEXT NOT NULL,			\
							spent REAL  NOT NULL,\
							est REAL  NOT NULL,\
							user TEXT  NOT NULL,\
							week TEXT  NOT NULL, \
							month TEXT  NOT NULL, \
							comment TEXT NOT NULL \
							)');

		//CARDBALANCE only keeps track of cards with pending balance per user, or balance per user issues (negative Spent, etc)
		t.executeSql('CREATE TABLE CARDBALANCE ( \
							idCard TEXT NOT NULL, \
							user TEXT NOT NULL, \
							spent REAL  NOT NULL,\
							est REAL  NOT NULL,\
							diff REAL NOT NULL, \
							date INT NOT NULL \
							)');

	});


	M.migration(2, function (t) {
		t.executeSql('CREATE INDEX idx_histByDate ON HISTORY(date DESC)'); //global history
		t.executeSql('CREATE INDEX idx_histByCard ON HISTORY(idCard,date DESC)'); //used by sync code when inserting new rows (where it updates idBoard), also for card history
		t.executeSql('CREATE INDEX idx_histByUserCard ON HISTORY(user, date DESC)'); //for drilldowns into users history by admins
		t.executeSql('CREATE INDEX idx_histByWeekUser ON HISTORY(week,user,date DESC)'); //for weekly report and (date) drilldown
		t.executeSql('CREATE INDEX idx_histByBoardUser ON HISTORY(idBoard, date ASC)'); //for board history
		t.executeSql('CREATE UNIQUE INDEX idx_cardbalanceByCardUserUnique ON CARDBALANCE(idCard, user ASC)'); //for insert integrity
		t.executeSql('CREATE INDEX idx_cardbalanceByCardUserDiff ON CARDBALANCE(idCard, user ASC, diff DESC)'); //for updating rows on insert and verifications
		t.executeSql('CREATE INDEX idx_cardbalanceByCardUserSpent ON CARDBALANCE(idCard, user ASC, spent DESC)'); //for fast reports
		t.executeSql('CREATE INDEX idx_cardbalanceByCardUserEst ON CARDBALANCE(idCard, user ASC, est DESC)'); //for fast reports
	});


	M.migration(3, function (t) {
		t.executeSql('ALTER TABLE HISTORY ADD COLUMN bSynced INT DEFAULT 0');
		t.executeSql('CREATE INDEX idx_histBySynced ON HISTORY(bSynced ASC)'); //to quickly find un-synced 
	});


	M.migration(4, function (t) {
		//bug in v2.2 caused bad row ids. fix them.
		var strFixIds = "UPDATE HISTORY set idHistory='id'||replace(idHistory,'-','') WHERE bSynced=0";
		t.executeSql(strFixIds, [], null,
			function (t2, error) {
				logPlusError(error.message);
				return true; //stop
			}
		);
	});


	M.migration(5, function (t) {
		t.executeSql('CREATE TABLE IF NOT EXISTS LOGMESSAGES ( \
							date INT NOT NULL, \
							message TEXT NOT NULL \
							)');
	});

	M.migration(6, function (t) {
		//BOARDMARKERS use rowid to calculate the SUMs for S/E instead of dates so that once a marker is started or stopped and calculated,
		// it wont be modified by back-reporting (-1d etc)
		//because rows are never deleted, sqLite will always autoincrement rowids, thus we can filter by them (http://sqlite.org/autoinc.html)
		t.executeSql('CREATE TABLE BOARDMARKERS ( \
							idBoard INT NOT NULL, \
							dateStart INT NOT NULL, \
							rowidHistoryStart INT NOT NULL, \
							spentStart REAL  NOT NULL,\
							estStart REAL  NOT NULL,\
							dateEnd INT, \
							rowidHistoryEnd INT, \
							spentEnd REAL,\
							estEnd REAL,\
							nameMarker TEXT NOT NULL, \
							userMarked TEXT NOT NULL, \
							userMarking TEXT NOT NULL \
							)');

		//dateEnd NULL iff marker is open
		//index note: would be cool to use sqlite partial indexes so we enforce uniqueness only on open markers, but its not supported in chrome
		//because the sqlite version in chrome is 3.7.x and partial indexes are supported from 3.8.0 (http://www.sqlite.org/partialindex.html)
		//currently we manually enforce the unique name on (userMarking, userMarked, nameMarker) WHERE dateEnd IS NULL (open markers)
		t.executeSql('CREATE INDEX idx_boardmarkersByBoard ON BOARDMARKERS(idBoard, userMarking, userMarked, nameMarker, dateEnd)'); //fast finds and row commit
		t.executeSql('CREATE INDEX idx_boardmarkersByUserMarked ON BOARDMARKERS(userMarked, dateEnd)'); //fast finds
		t.executeSql('CREATE INDEX idx_boardmarkersByUserMarking ON BOARDMARKERS(userMarking, dateEnd)'); //fast finds
		t.executeSql('CREATE INDEX idx_cardsByBoard ON CARDS(idBoard, idCard)'); //future fast join/filter by board
		t.executeSql('CREATE INDEX idx_histByBoardRowId ON HISTORY(idBoard, user ASC)'); //to calculate board mark balances. note sqlite doesnt allow including rowid here.
	});

	M.migration(7, function (t) {
		t.executeSql("DELETE FROM LOGMESSAGES where message LIKE '%disconnected port%'");
		t.executeSql("ALTER TABLE HISTORY ADD COLUMN eType INT");
		updateAllETypes(t);
	});

	M.doIt();
}

function handleUpdateRowEtype(row, mapBalance, tx) {
	var eType = ETYPE_NONE;
	var key = row.idCard + "-" + row.user;
	if (mapBalance[key]) {
		if (row.nameCard && row.nameCard.indexOf(TAG_RECURRING_CARD) >= 0)
			eType = ETYPE_NONE;
		else if (row.est > 0)
			eType = ETYPE_INCR;
		else if (row.est < 0)
			eType = ETYPE_DECR;
	} else {
		eType = ETYPE_NEW;
		mapBalance[key] = true;
	}
	if (eType != row.eType) {
		var sql = "UPDATE HISTORY SET eType=? WHERE rowid=?";
		tx.executeSql(sql, [eType, row.rowid],
		null,
		function (tx2, error) {
			logPlusError(error.message + " sql: " + sql);
			return true; //stop
		});
	}
}

function updateAllETypes(tx) {
	var sql = "SELECT H.user, H.idCard, H.spent, H.est, H.eType,H.rowid,C.name as nameCard FROM HISTORY H JOIN CARDS C ON H.idCard=C.idCard order by H.rowid ASC";
	tx.executeSql(sql, [],
			function (tx2, results) {
				var i = 0;
				var mapBalance = {}; //track new state. can get big on a large file
				for (; i < results.rows.length; i++) {
					var row=results.rows.item(i);
					handleUpdateRowEtype(row, mapBalance, tx2);
				}
			},
			function (trans, error) {
				logPlusError(error.message + " sql: " + sql);
				return true; //stop
			});
}

function makeRowGsxField(name, value) {
	return "<gsx:" + name + ">" + value + "</gsx:" + name + ">";
}

function xmlEscape(str) {
	return str.replace(/&/g, '&amp;')
				  .replace(/</g, '&lt;')
				  .replace(/>/g, '&gt;')
				  .replace(/"/g, '&quot;')
				  .replace(/'/g, '&apos;');
}

function makeRowAtom(date, board, card, spenth, esth, who, week, month, comment, idBoard, idCard, idtrello) {
	var cardurl = "https://trello.com/c/" + idCard;
	var ssRowId = idtrello + "-" + idCard + "-" + idBoard;
	var atom = '<entry xmlns="http://www.w3.org/2005/Atom" xmlns:gsx="http://schemas.google.com/spreadsheets/2006/extended">';
	var names = ['date', 'board', 'card', 'spenth', 'esth', 'who', 'week', 'month', 'comment', 'cardurl', 'idtrello'];
	var values = [date, xmlEscape(board), xmlEscape(card), spenth, esth, xmlEscape(who), week, month, xmlEscape(comment), cardurl, xmlEscape(ssRowId)];

	//Note: everything is escaped with ' to escape problems with different spreadsheet regional settings.
	//this means that the raw spreadsheets can no longer be used to make spreadsheet reports that extract info from the date or amounts
	var i = 0;
	for (; i < names.length; i++) {
		atom += makeRowGsxField(names[i], "'" + values[i]);
	}
	atom += '</entry>';
	return atom;
}

function makeMessageAtom(message) {
	var atom = '<entry xmlns="http://www.w3.org/2005/Atom" xmlns:gsx="http://schemas.google.com/spreadsheets/2006/extended">';

	atom += makeRowGsxField("message", "'" + message);
	atom += '</entry>';
	return atom;
}