var g_bLoaded = false; //needed because DOMContentLoaded gets called again when we modify the page
var g_mapETypeParam = { "all": "", "eincr": 1, "edecr": -1, "enew": 2 };
var g_iTabCur = 0;
var g_colorDefaultOver="#B9FFA9";
var g_colorDefaultUnder="#FFD5BD";
var KEY_FORMAT_PIVOT_USER = "formatPivotUser";
var KEY_FORMAT_PIVOT_BOARD = "formatPivotBoard";
var g_cSyncSleep = 0;  //for controlling sync abuse
var g_bIgnoreEnter = false; //review zig
var g_rgTabScrollData = [];

//cache formats to avoid overloading sync. "format" is saved to sync so short names there to reduce sync usage
var g_dataFormatUser = { key:KEY_FORMAT_PIVOT_USER, interval: null, cLastWrite:0, cCur: 0, format: { u: { c: g_colorDefaultUnder, v: null }, o: { c: g_colorDefaultOver, v: null } }};
var g_dataFormatBoard = { key:KEY_FORMAT_PIVOT_BOARD, interval: null, cLastWrite: 0, cCur: 0, format: { u: { c: g_colorDefaultUnder, v: null }, o: { c: g_colorDefaultOver, v: null } } };

function loadPivotFormats(callback) {
	chrome.storage.sync.get([KEY_FORMAT_PIVOT_USER, KEY_FORMAT_PIVOT_BOARD], function (objs) {
		if (objs[KEY_FORMAT_PIVOT_USER] !== undefined)
			g_dataFormatUser.format = objs[KEY_FORMAT_PIVOT_USER];
		if (objs[KEY_FORMAT_PIVOT_BOARD] !== undefined)
			g_dataFormatBoard.format = objs[KEY_FORMAT_PIVOT_BOARD];
		callback();
	});
}

document.addEventListener('DOMContentLoaded', function () {
	//chrome Content Security Policy (CSP) makes us use DOMContentLoaded
	if (g_bLoaded)
		return;
	g_bLoaded = true;
	$("#tabs").tabs({
		activate: function (event, ui) {
			g_iTabCur = ui.newTab.index();
			var params = getUrlParams();
			params["tab"] = g_iTabCur;
			var resizeInfo = g_rgTabScrollData[g_iTabCur];
			if (resizeInfo)
				setScrollerHeight(resizeInfo.scroller, resizeInfo.elemTop, resizeInfo.dyTop);
			updateUrlState("report.html", params);
		}
	});
	loadPivotFormats(function () {
		configAllPivotFormats();
		loadReport();
	});
});

function configPivotFormat(elemFormat, dataFormat, tableContainer) {
	var underElem = elemFormat.children(".agile_format_under");
	var overElem = elemFormat.children(".agile_format_over");
	var colorUnderElem = elemFormat.children(".agile_colorpicker_colorUnder");
	var colorOverElem = elemFormat.children(".agile_colorpicker_colorOver");
	var colorNormal = "#E8EBEE"; //review zig: get it from css

	var copyWindow = elemFormat.children(".agile_drilldown_select");
	if (copyWindow.length > 0) {
		copyWindow.attr("src", chrome.extension.getURL("images/copy.png"));
		copyWindow.attr("title", "Click to copy table to your clipboard, then paste elsewhere (email, spreadsheet, etc.)");
		copyWindow.click(function () {
			var table = tableContainer;
			selectElementContents(table[0]);
		});
	}

	underElem.val(dataFormat.format.u.v);
	colorUnderElem.val(dataFormat.format.u.c);
	overElem.val(dataFormat.format.o.v);
	colorOverElem.val(dataFormat.format.o.c);
	function applyFormat() {

		var strUnder = underElem.val();
		var strOver = overElem.val();
		var valUnder = (strUnder.length ==0? null : parseFloat(strUnder));
		var valOver = (strOver.length ==0? null : parseFloat(strOver));
		var cells = tableContainer.find(".agile_pivot_value");
		var colorUnder = colorUnderElem.val();
		var colorOver = colorOverElem.val();

		savePivotFormat(dataFormat, colorUnder, colorOver, valUnder, valOver);
		cells.each(function () {
			var el = $(this);
			var val = parseFloat(el.text());
			var color = colorNormal;
			if (valUnder != null && val < valUnder)
				color = colorUnder;
			else if (valOver != null && val > valOver)
				color = colorOver;
			el.css("background", color);
			var rgb = null;
			var colorText = "black";
			if (rgb  = /^#([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})/.exec(color)) {
				rgb = [parseInt(rgb[1], 16), parseInt(rgb[2], 16), parseInt(rgb[3], 16)];
				var sum = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722; //standard luminance. This will never be perfect a user's gamma/calibration is never the same.
				if (sum < 128)	
					colorText = "white";
			}
			el.css("color", colorText);
		});
	}

	applyFormat();
	underElem.on('input',applyFormat);
	overElem.on('input', applyFormat);
	colorUnderElem.on('input', applyFormat);
	colorOverElem.on('input', applyFormat);
}

function savePivotFormat(dataFormat, colorUnder, colorOver, valUnder, valOver) {
	var before = JSON.stringify(dataFormat.format);
	var obj = dataFormat.format.u;
	obj.c = colorUnder;
	obj.v = valUnder;
	obj = dataFormat.format.o;
	obj.c = colorOver;
	obj.v = valOver;
	var after = JSON.stringify(dataFormat.format);
	var waitNormal = 4000;

	function saveToSync(bNow) {
		//look until it stabilizes, otherwise dont sync it this time.
		var lastFormat = JSON.stringify(dataFormat.format);
		var wait = waitNormal*3/4;
		if (bNow && bNow == true)
			wait = 200;

		setTimeout(function () {
			if (!bNow && g_cSyncSleep > 0) {
				g_cSyncSleep--;
				return;
			}
			var currentFormat = JSON.stringify(dataFormat.format);
			if (currentFormat != lastFormat)
				return;
			var pair = {};
			var cCur = dataFormat.cCur; //separate from global format
			pair[dataFormat.key] = dataFormat.format;
			chrome.storage.sync.set(pair, function () {
				if (chrome.runtime.lastError === undefined)
					dataFormat.cLastWrite = Math.max(dataFormat.cLastWrite, cCur);
				else
					g_cSyncSleep = 5; //will sleep next x cicles
			});
		}, wait);
	}

	if (before != after) {
		dataFormat.cCur++;
		if (dataFormat.interval == null) {
			saveToSync(true); //first change saves right away
			dataFormat.interval = setInterval(function () {
				if (dataFormat.cCur != dataFormat.cLastWrite)
					saveToSync(false);
			}, waitNormal); //keep sync quotas happy
		}
	}
}

function invertColor(hexTripletColor) {
	var color = hexTripletColor;
	color = color.substring(1);           // remove #
	color = parseInt(color, 16);          // convert to integer
	color = 0xFFFFFF ^ color;             // invert three bytes
	color = color.toString(16);           // convert to hex
	color = ("000000" + color).slice(-6); // pad with leading zeros
	color = "#" + color;                  // prepend #
	return color;
}

function getParamAndPutInFilter(elem, params, name, valDefault) {
	var value = params[name];
	var str = "";
	var bShowHide = (valDefault == "showhide");
	if (!bShowHide)
		str = valDefault;
	if (value && value != "")
		str = decodeURIComponent(value);
	if (name.indexOf("check") == 0)
		elem[0].checked = (str=="true");
	else
		elem.val(str);
	if (bShowHide) {
		var parent = elem.parent();
		if (str.length > 0)
			parent.show();
		else {
			parent.hide();
		}
	}

	return str;
}

function loadReport() {
	var params = getUrlParams();
	g_iTabCur = params["tab"] || 0;
	g_bPopupMode = (params["popup"] == "1");
	if (g_bPopupMode) {
		$("#title_header").hide();
		$("body").width(620);
		$("body").css("max-height", 600); //.height(600);
		var dockOut = $("#dockoutImg");
		dockOut.attr("src", chrome.extension.getURL("images/dockout.png"));
		dockOut.show();
		dockOut.css("cursor", "pointer");
		dockOut.click(function () { //cant use setPopupClickHandler because url could have changed if user navigated inside 
			var urlDockout = buildUrlFromParams("report.html", getUrlParams(), true);
			chrome.tabs.create({ url: urlDockout });
			return false;
		});
	}
	$("#divMain").show();
	$("#tabs").tabs("option", "active", g_iTabCur);
	
	var weekStartDefault = "";
	if (params.weekStartRecent == "true") {
		var date = new Date();
		var weeks = 5;
		date.setDate(date.getDate() - date.getDay() - 7 * weeks);
		weekStartDefault = getCurrentWeekNum(date);
	}
	var elems = { groupBy: "", orderBy: "date", weekStart: weekStartDefault, weekEnd: "", monthStart: "", monthEnd: "", user: "", board: "", card: "", comment: "", eType: "all", idBoard: "showhide", idCard: "showhide", checkNoCrop: "false" };
	for (var iobj in elems) {
		var elemCur = $("#" + iobj);
		elemCur.keypress(function (event) {
			if (g_bIgnoreEnter)
				return;
			var keycode = (event.keyCode ? event.keyCode : event.which);
			if (keycode == '13') {
				onQuery();
			}
		});
		getParamAndPutInFilter(elemCur, params, iobj, elems[iobj]);
	}

	var btn = $("#buttonFilter");

	function onQuery() {
		if (false) { //review zig: figure out how to make this work.
			var iForms = 0;
			var forms = $("form");
			function handleFormsSubmit(iform, forms) {
				setTimeout(function () {
					document.forms[forms[iform].name].submit();
					if (iform + 1 < forms.length)
						handleFormsSubmit(iform + 1, forms);
				}, 100);
			}

			handleFormsSubmit(0, forms);
		}
		setBusy(true, btn);
		btn.attr('disabled', 'disabled');
		for (var iobj in elems) {
			if (iobj.indexOf("check") == 0)
				elems[iobj] = ($("#" + iobj)[0].checked ? "true" : "false"); //keep it a string so its similar to the other properties
			else
				elems[iobj] = $("#" + iobj).val();
		}
		if (g_iTabCur != 0)
			elems["tab"] = g_iTabCur;
		//these set of timeouts could be done all together but the GUI wont update instantly.
		//handles this case: 1) make a huge report, 2) view by User, 3) change the filter and click Query again.
		//without this, the pivot view would take a long time to clear because its waiting for the report to clear (which can take a few seconds with 10,000 rows).
		setTimeout(function () {
			$(".agile_report_container_byUser").html("...");
			$(".agile_report_container_byBoard").html("...");
			setTimeout(function () {
				$(".agile_topLevelTooltipContainer").html("...");
				setTimeout(function () {
					configReport(elems);
				}, 1);
			}, 1);
		}, 1);
	}

	btn.click(function () {
		onQuery();
	});

	if (Object.keys(params).length > 0) //prevent executing query automatically when no parameters
		setTimeout(function () { btn.click(); }, 10);
}


function showError(err) {
	alert(err);
}

function completeString(str, pattern) {
	var c = pattern.length;
	while (str.length < c)
		str = str + pattern.charAt(str.length);
	return str;
}

function buildSqlParam(param, params, sqlField, operator, state, completerPattern) {
	var val = params[param];
	if (val == "")
		return "";

	var bString = (typeof (val) == 'string');
	if (completerPattern)
		val = completeString(val, completerPattern);
	var sql = "";
	if (bString)
		val = val.toUpperCase();
	if (state.cFilters == 0)
		sql += " WHERE ";
	else
		sql += " AND ";

	var decorate = "";
	if (operator.toUpperCase() == "LIKE")
		decorate = "%";
	if (bString)
		sql += ("UPPER(" + sqlField + ") " + operator + " ?");
	else
		sql += (sqlField + " " + operator + " ?");
	state.cFilters++;
	state.values.push(decorate + val + decorate);
	return sql;
}

function buildSql(elems, groupBy) {
	var sql = "select H.user, H.week, H.month, H.spent, H.est, H.date, H.comment, H.idCard as idCardH, H.idBoard as idBoardH, C.name as nameCard, B.name as nameBoard, H.eType FROM HISTORY as H JOIN CARDS as C on H.idCard=C.idCard JOIN BOARDS B on H.idBoard=B.idBoard";
	var post1 = "";
	var post2 = " order by H.date DESC";

	if (groupBy == "idBoardH" || groupBy == "idBoardH-user" || groupBy == "user") {
		//if using these groupings, we can optimize and have SQL do a few sums for us. Can reduce the returned rows by a factor or 5 or so.
		//first, some search fields must be empty.
		var rgCheck = ["monthStart", "monthEnd", "card", "comment", "eType", "idCard"];
		var iCheck = 0;
		for (; iCheck < rgCheck.length; iCheck++) {
			if (elems[rgCheck[iCheck]].length > 0)
				break;
		}
		//if all checked fields are empty, change the query to use group by.
		if (iCheck == rgCheck.length) {
			sql = "select H.user, H.week, 0 as month, SUM(H.spent) as spent, SUM(H.est) as est, MAX(H.date) as date, '' as comment, 0 as idCardH, H.idBoard as idBoardH, '' as nameCard, B.name as nameBoard, '' as eType FROM HISTORY as H JOIN BOARDS B on H.idBoard=B.idBoard";
			post1 = " group by B.idBoard, H.user, H.week";
		}
	}

	var state = { cFilters: 0, values: [] };

	sql += buildSqlParam("weekStart", elems, "week", ">=", state);
	sql += buildSqlParam("weekEnd", elems, "week", "<=", state, "9999-W99");
	sql += buildSqlParam("monthStart", elems, "month", ">=", state);
	sql += buildSqlParam("monthEnd", elems, "month", "<=", state, "9999-99");
	sql += buildSqlParam("user", elems, "user", "LIKE", state);
	sql += buildSqlParam("board", elems, "nameBoard", "LIKE", state);
	sql += buildSqlParam("card", elems, "nameCard", "LIKE", state);
	sql += buildSqlParam("comment", elems, "comment", "LIKE", state);
	sql += buildSqlParam("eType", elems, "eType", "=", state);
	sql += buildSqlParam("idBoard", elems, "idBoardH", "=", state);
	sql += buildSqlParam("idCard", elems, "idCardH", "=", state);
	sql += post1;
	sql += post2;
	return { sql: sql, values: state.values };
}

function configReport(elemsParam) {
	var elems = cloneObject(elemsParam);
	if (elems["eType"] == "all") //do this before updateUrlState so it doesnt include this default in the url
		elems["eType"] = ""; //this prevents growing the URL with the default value for eType

	if (elems["checkNoCrop"] == "false")
		elems["checkNoCrop"] = ""; //ditto like eType
	updateUrlState("report.html", elems);

	//after updateUrlState map eType to it real value. We do it here so the url looks less crypic.
	if (elems["eType"] != "")
		elems["eType"] = g_mapETypeParam[elems["eType"]];
	setBusy(true);
	var groupBy = elems["groupBy"] || "";

	sendExtensionMessage({ method: "openDB" },
			function (response) {
				if (response.status != "OK") {
					showError(response.status);
					return;
				}
				var sqlQuery = buildSql(elems, groupBy);
				getSQLReport(sqlQuery.sql, sqlQuery.values,
					function (response) {
						var rows = response.rows;
						try {
							setReportData(rows, elems["checkNoCrop"] == "true", elems);
						}
						catch (e) {
							var strError = "Error: " + e.message;
							showError(strError);
						}
					});
			});
}

function setReportData(rowsOrig, bNoTruncate, urlParams) {
	var rowsGrouped = rowsOrig;

	var groupBy = urlParams["groupBy"];
	var orderBy = urlParams["orderBy"];
	if (groupBy.length > 0 || (orderBy.length > 0 && orderBy!="date"))
		rowsGrouped=groupRows(rowsOrig, groupBy, orderBy);
	var html = getHtmlDrillDownTooltip(rowsGrouped, bNoTruncate, groupBy, orderBy, urlParams["eType"]);
	var parentScroller = $(".agile_report_container");
	var container = makeReportContainer(html, 1300, true, parentScroller);
	g_rgTabScrollData[0] = { scroller: parentScroller.find(".agile_tooltip_scroller"), elemTop: parentScroller, dyTop: 50 }; //review zig: fix this mess
	setBusy(false);
	var btn = $("#buttonFilter");
	setBusy(false, btn);
	btn.removeAttr('disabled');
	fillPivotTables(rowsOrig, $(".agile_report_container_byUser"), $(".agile_report_container_byBoard"), urlParams);
}

function fillPivotTables(rows, elemByUser, elemByBoard, urlParams) {
	var tables = calculateTables(rows);
	//{ header: header, tips: tips, byUser: rgUserRows, byBoard: rgBoardRows };
	var parent = elemByUser.parent();
	var dyTop = 70;
	g_rgTabScrollData[1] = { scroller: elemByUser, elemTop: parent, dyTop: dyTop };
	g_rgTabScrollData[2] = { scroller: elemByBoard, elemTop: parent, dyTop: dyTop };
	var strTh = "<th class='agile_header_pivot agile_pivotCell'>";
	var strTd = '<td class="agile_nowrap agile_pivotCell">';
	var strTable = "<table class='agile_table_pivot' cellpadding=2 cellspacing=0>";
	var elemTableUser = $(strTable);
	var trUser = $("<tr>");
	var elemTableBoard = $(strTable);
	var trBoard = $("<tr>");
	var replaces = [];

	function addClickZoom(tdElem, urlParams, replaces) {
		//note: would be better to use anchors but I couldnt get them to be clickable in the whole cell so I went back
		//to using a click handler on the cell
		var i = 0;
		var params = cloneObject(urlParams); //each click callback needs its own
		for (; i < replaces.length; i++) {
			var rep = replaces[i];
			params[rep.name] = rep.value;
		}
		params["tab"] = 0;
		var url = buildUrlFromParams("report.html", params);
		var urlCtrl = buildUrlFromParams("report.html", params, true);
		tdElem.css("cursor", "-webkit-zoom-in");
		tdElem.addClass("agile_hoverZoom");
		tdElem.click(function (e) {
			if (e.ctrlKey)
				window.open(urlCtrl, '_blank');
			else
				window.location.href = url;
		});
	}

	var iCol = 0;

	//HEADERS
	for (; iCol < tables.header.length; iCol++) {
		var val = tables.header[iCol];
		var tdUser = $(strTh).text(val).attr("title", tables.tips[iCol]);
		var tdBoard = $(strTh).text(val).attr("title", tables.tips[iCol]);
		replaces = [{ name: "weekStart", value: val }, { name: "weekEnd", value: val }];
		if (val.length > 0) {
			addClickZoom(tdUser, urlParams, replaces);
			addClickZoom(tdBoard, urlParams, replaces);
		}

		if (iCol == 0) {
			tdUser.text("User");
			tdBoard.text("Board");
		}
		trUser.append(tdUser);
		trBoard.append(tdBoard);
	}
	elemTableUser.append(trUser);
	elemTableBoard.append(trBoard);

	//BY USER
	var iRow = 0;
	for (; iRow < tables.byUser.length; iRow++) {
		trUser = $("<tr>");
		var tdUserCol = $(strTd).text(tables.byUser[iRow][0]).addClass("agile_leftAlign");
		trUser.append(tdUserCol);
		var valUser=tables.byUser[iRow][0] ;
		replaces = [{ name: "user", value: valUser }];
		addClickZoom(tdUserCol, urlParams, replaces);
		for (iCol = 1; iCol < tables.header.length; iCol++) {
			var strHeader = tables.header[iCol];
			var val = parseFixedFloat(tables.byUser[iRow][iCol]) || 0;
			var tdElem = $(strTd).text(val).addClass("agile_pivot_value");
			trUser.append(tdElem);
			replaces = [{ name: "weekStart", value: strHeader }, { name: "weekEnd", value: strHeader }, { name: "user", value: valUser }];
			addClickZoom(tdElem, urlParams, replaces);
		}
		elemTableUser.append(trUser);
	}

	//BY BOARD
	for (iRow=0; iRow < tables.byBoard.length; iRow++) {
		trBoard = $("<tr>");
		var tdBoardCol = $(strTd).text(tables.byBoard[iRow][0].name).addClass("agile_leftAlign");
		trBoard.append(tdBoardCol);
		var valIdBoard = tables.byBoard[iRow][0].idBoard;
		var replaces = [{ name: "idBoard", value: valIdBoard }];
		addClickZoom(tdBoardCol, urlParams, replaces);

		for (iCol = 1; iCol < tables.header.length; iCol++) {
			var strHeader = tables.header[iCol];
			var val = parseFixedFloat(tables.byBoard[iRow][iCol]) || 0;
			var tdElem = $(strTd).text(val).addClass("agile_pivot_value");
			trBoard.append(tdElem);
			replaces = [{ name: "weekStart", value: strHeader }, { name: "weekEnd", value: strHeader }, { name: "idBoard", value: valIdBoard }];
			addClickZoom(tdElem, urlParams, replaces);
		}
		elemTableBoard.append(trBoard);
	}

	elemByUser.empty();
	elemByBoard.empty();
	elemByUser.append(elemTableUser);
	elemByBoard.append(elemTableBoard);
	configAllPivotFormats();
}

function configAllPivotFormats() {
	configPivotFormat($("#tabs-2 .agile_format_container"), g_dataFormatUser, $(".agile_report_container_byUser"));
	configPivotFormat($("#tabs-3 .agile_format_container"), g_dataFormatBoard, $(".agile_report_container_byBoard"));
}


function calculateTables(rows) {
	var header = [""];
	var users = {};
	var boards = {};
	var i = 0;
	var iColumn = 0;
	var weekLast = "";
	var tips= [""]; //tip for each header element

	for (; i < rows.length; i++) {
		var row = rows[i];
		if (row.spent == 0)
			continue;
		var weekCur = row.week;
		if (weekCur != weekLast) {
			iColumn++;
			header[iColumn] = weekCur;
			weekLast = weekCur;
			var dateStart = new Date(row.date * 1000);
			dateStart.setDate(dateStart.getDate() - dateStart.getDay());
			var title = dateStart.toLocaleDateString();
			dateStart.setDate(dateStart.getDate() + 6);
			title = title + " - " + dateStart.toLocaleDateString();
			tips[iColumn] = title;
		}
		var userRow = users[row.user];
		var bWasEmpty= (userRow === undefined);
		if (bWasEmpty)
			userRow = [row.user];
		var sumUser = userRow[iColumn] || 0;
		userRow[iColumn] = sumUser + row.spent;
		if (bWasEmpty)
			users[row.user] = userRow;

		var boardRow = boards[row.nameBoard];
		bWasEmpty = (boardRow === undefined);
		if (bWasEmpty)
			boardRow = [{ name: row.nameBoard, idBoard: row.idBoardH }];
		var sumBoard = boardRow[iColumn] || 0;
		boardRow[iColumn] = sumBoard + row.spent;
		if (bWasEmpty)
			boards[row.nameBoard] = boardRow;
	}


	function doSortUser(a, b) {
		return (a[0].toLowerCase().localeCompare(b[0].toLowerCase()));
	}

	function doSortBoard(a, b) {
		return (a[0].name.toLowerCase().localeCompare(b[0].name.toLowerCase()));
	}

	var rgUserRows = [];
	var rgBoardRows = [];
	for (i in users) 
		rgUserRows.push(users[i]);
	rgUserRows.sort(doSortUser);

	for (i in boards)
		rgBoardRows.push(boards[i]);
	rgBoardRows.sort(doSortBoard);
	return { header: header, tips:tips, byUser: rgUserRows, byBoard: rgBoardRows };
}


function groupRows(rowsOrig, propertyGroup, propertySort) {

	var ret = [];
	if (propertyGroup.length > 0) {
		var i = 0;
		var map = {};
		var cMax = rowsOrig.length;
		var pGroups = propertyGroup.split("-");
		for (; i < cMax; i++) {
			var row = rowsOrig[i];
			var key = "";
			var iProp = 0;
			for (; iProp < pGroups.length; iProp++)
				key = key + "/" + row[pGroups[iProp]];
			var group = map[key];
			if (group === undefined)
				group = cloneObject(row);
			else {
				group.spent += row.spent;
				group.est += row.est;
			}
			map[key] = group;
		}


		for (i in map) {
			ret.push(map[i]);
		}
	} else {
		ret = cloneObject(rowsOrig);
	}

	if (ret.length > 0 && propertySort.length > 0 && propertySort != "date") {
		var bString = typeof(ret[0][propertySort])=="string";
		var bRemain = (propertySort=="remain");
		ret.sort(function doSort(a, b) {
			if (bString)
				return (a[propertySort].localeCompare(b[propertySort]));
			var va = null;
			var vb = null;

			if (bRemain) {
				va = a.est - a.spent;
				vb = b.est - b.spent;
			} else {
				va = a[propertySort];
				vb = b[propertySort];
			}
			return (vb - va);
		});
		if (bRemain && propertyGroup.length>0) {
			//chop off all zero remains
			
		}
	}
	return ret;
}

function getHtmlDrillDownTooltip(rows, bNoTruncate, groupBy, orderBy, eType) {
	var bOrderR = (orderBy == "remain");
	var header = [{ name: "Date" }, { name: "Week" }, { name: "Month" }];
	var bShowUser=(groupBy=="" || groupBy.indexOf("user")>=0);
	if (bShowUser)
		header.push({ name: "User" });
	
	var bShowBoard=(groupBy=="" || groupBy.indexOf("idBoardH")>=0 || groupBy.indexOf("idCardH")>=0);
	if (bShowBoard)
		header.push({ name: "Board" });

	var bShowCard=(groupBy=="" || groupBy.indexOf("idCardH")>=0);
	if (bShowCard)
		header.push({ name: "Card" });
	
	header.push({ name: "S" });
	header.push({ name: "E" });

	bShowRemain = (bOrderR || groupBy != "");
	if (bShowRemain)
		header.push({ name: "R" });

	var bShowComment = (groupBy == "");
	if (bShowComment)
		header.push({ name: "Comment", bExtend: true });
	
	var bShowEtype= (eType!="");

	if (bShowEtype)
		header.push({ name: COLUMNNAME_ETYPE });
	
	function callbackRowData(row) {
		var rgRet = [];
		var date = new Date(row.date * 1000); //db is in seconds
		rgRet.push({ name: date.toDateString(), bNoTruncate: true });
		rgRet.push({ name: row.week, bNoTruncate: true });
		rgRet.push({ name: row.month, bNoTruncate: true });
		if (bShowUser)
			rgRet.push({ name: row.user, bNoTruncate: bNoTruncate });

		if (bShowBoard) {
			var urlBoard = "https://trello.com/b/" + row.idBoardH;
			rgRet.push({ name: "<A title='Go to Trello board' target='_blank' href='" + urlBoard + "'>" + strTruncate(row.nameBoard) + "</A>", bNoTruncate: true });
		}

		if (bShowCard) {
			var urlCard = null;
			if (row.idCardH.indexOf("https://") == 0)
				urlCard = row.idCardH; //old-style card URLs. Could be on old historical data from a previous Spent version
			else
				urlCard = "https://trello.com/c/" + row.idCardH;

			rgRet.push({ name: "<A title='Go to Trello card' target='_blank' href='" + urlCard + "'>" + strTruncate(row.nameCard) + "</A>", bNoTruncate: true });
		}

		rgRet.push({ name: parseFixedFloat(row.spent), bNoTruncate: true });
		rgRet.push({ name: parseFixedFloat(row.est), bNoTruncate: true });
		if (bShowRemain) {
			var remainCalc = parseFixedFloat(row.est - row.spent);
			if (bOrderR && remainCalc == 0)
				return [];
			rgRet.push({ name: remainCalc, bNoTruncate: true });
		}
		if (bShowComment)
			rgRet.push({ name: row.comment, bNoTruncate: bNoTruncate });

		if (bShowEtype)
			rgRet.push({ name: nameFromEType(row.eType), bNoTruncate: true });

		if (!bShowComment) {
			var title="Last: ";
			title +=  row.user;
			title += " - " + row.nameBoard;
			title += " - " + row.nameCard;
			title += " - " + row.comment;

			rgRet.title = title;
		} else {
			if (row.comment.length > g_cchTruncateDefault)
				rgRet.title = row.comment;
		}
		return rgRet;
	}

	return getHtmlBurndownTooltipFromRows(true, rows, false, header, callbackRowData, true, "");
}

function getSQLReport(sql, values, callback) {
	getSQLReportShared(sql, values, callback, function onError(status) {
		showError(status);
	});
}