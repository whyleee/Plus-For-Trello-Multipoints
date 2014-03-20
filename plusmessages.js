var g_bLoaded = false; //needed because DOMContentLoaded gets called again when we modify the page


document.addEventListener('DOMContentLoaded', function () {
	if (g_bLoaded)
		return;
	g_bLoaded = true;
	//chrome Content Security Policy (CSP) makes us do it like this
	loadReport();
});


function loadReport() {
	$("#buttonClear").click(function () {
		if (!confirm('Are you sure you want to delete the log? You cant undo it.'))
			return;
		sendExtensionMessage({ method: "clearAllLogMessages" },
			function (response) {
				if (response.status != "OK") {
					alert(response.status);
					return;
				}
				configReport();
			});
	});
	configReport();
}


function showError(err) {
	alert(err);
}

function buildSql(elems) {
	var sql = "select date, message FROM LOGMESSAGES ORDER BY date DESC";
	return { sql: sql, values: [] };
}

function configReport() {
	setBusy(true);
	sendExtensionMessage({ method: "openDB" },
			function (response) {
				if (response.status != "OK") {
					showError(response.status);
					return;
				}
				var sqlQuery = buildSql();
				getSQLReport(sqlQuery.sql, sqlQuery.values,
					function (response) {
						var rows = response.rows;
						try {
							setReportData(rows);
						}
						catch (e) {
							var strError = "Error: " + e.message;
							showError(strError);
						}
					});
			});
}


function setReportData(rows) {
	var html = getHtmlDrillDownTooltip(rows);
	var container = makeReportContainer(html, 1300, true);
	setBusy(false);
}

function getHtmlDrillDownTooltip(rows) {
	var header = [{ name: "Date" }, { name: "Message", bExtend: true }];
	function callbackRowData(row) {
		var rgRet = [];
		var date = new Date(row.date * 1000); //db is in seconds
		var msg = row.message.replace(/\n/g, '<br />');
		rgRet.push({ name: date.toLocaleString(), bNoTruncate: true });
		rgRet.push({ name: msg, bNoTruncate: true });
		rgRet.title = row.message;
		return rgRet;
	}

	return getHtmlBurndownTooltipFromRows(false, rows, false, header, callbackRowData, true, "Error log", true);
}

function getSQLReport(sql, values, callback) {
	getSQLReportShared(sql, values, callback, function onError(status) {
		showError(status);
	});
}