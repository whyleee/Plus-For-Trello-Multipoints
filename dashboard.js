var g_bLoaded = false; //needed because DOMContentLoaded gets called again when we modify the page
var g_marginLabelChart = 35;
var g_heightBarUser = 30;

var g_chart = null;
var g_data = null;
var g_chartUser = null;
var g_dataUser = null;
var g_boardName = "";
var g_userTrello = null;

document.addEventListener('DOMContentLoaded', function () {
	if (g_bLoaded)
		return;
	g_bLoaded = true;
	//chrome Content Security Policy (CSP) makes us do it like this
	google.setOnLoadCallback(loadBurndown);
});

function redrawCharts() {
	drawChart();
	drawChartUser();
}

window.addEventListener('resize', function () {
	redrawCharts();
});


function showError(strError) {
	logPlusError(strError);
	var progress = document.getElementById("progress");
	progress.innerText = strError;
	progress.style.display = "block";
}

function configBoardBurndownData(idBoard) {
	sendExtensionMessage({ method: "openDB" },
			function (response) {
				if (response.status != "OK") {
					showError(response.status);
					return;
				}
				var sql = "select H.user, H.spent, H.est, H.date, H.comment, H.eType, H.idCard, C.name FROM HISTORY as H JOIN CARDS as C on H.idCard=C.idCard WHERE c.idBoard=? order by H.date ASC";
				var values = [idBoard];
				getSQLReport(sql, values,
					function (response) {
						var rows = response.rows;
						try {
							setChartData(rows, idBoard);
						}
						catch (e) {
							var strError = "Error: " + e.message;
							showError(strError);
						}
					});
			});
}



function createCloseTooptipMonitor(callback) {
	var classHooked = "closeBurndownTooltip_hooked";
	setInterval(function () {
		var elems = $(".closeBurndownTooltip");
		if (elems.length>0 && !elems.hasClass(classHooked)) {
			elems.click(function () {
				setTimeout(function () { callback(); }, 20);
				
			});
			elems.addClass(classHooked);
		}
	}, 300);
}

function loadBurndown() {
	createCloseTooptipMonitor(drawChart);
	var params = getUrlParams();
	var idBoard = decodeURIComponent(params["idBoard"]);
	var boardName = decodeURIComponent(params["board"]);
	document.title = (boardName + " - Plus Dashboard");
	$("#topTitle").text(document.title);
	g_boardName = boardName;
	$("#reportLink").attr("href", chrome.extension.getURL("report.html?idBoard=") + encodeURIComponent(idBoard)+"&weekStartRecent=true");
	var header = $("#headerMarker");
	var container = $("#boardMarkersContainer");
	header.click(function () {
		handleSectionSlide(container, $("#boardMarkersContent"));
	});
	chrome.storage.local.get([PROP_TRELLOUSER, PROP_SHOWBOARDMARKERS], function (obj) {
		g_userTrello = obj[PROP_TRELLOUSER];
		configBoardBurndownData(idBoard);
		g_bShowBoardMarkers = (obj[PROP_SHOWBOARDMARKERS] || false);
	});
}

var g_bShowBoardMarkers = false;

function loadBoardMarkers(idBoard, totalByUser) {
	var sql = "SELECT datetime(dateStart,'unixepoch','localtime') as dateStartStr, datetime(dateEnd,'unixepoch','localtime') as dateEndStr, dateStart, dateEnd, userMarked, userMarking, spentStart, estStart, spentEnd, estEnd, nameMarker \
					FROM boardmarkers where idBoard=? ORDER BY dateStart DESC";
	var values = [idBoard];
	getSQLReport(sql, values,
		function (response) {
			var rows = response.rows;
			var container = $("#boardMarkersContainer");
			var table = $("#tableMarkers");

			table.empty();
			if (rows && rows.length > 0) {
				var i = 0;
				var header = { dateStartStr: 'Begin date', dateEndStr: 'End date', cDays: 'Days', userMarked: 'For user', userMarking: 'By', seStart: 'Begin S/E', seEnd: 'End S/E', nameMarker: 'Marker name' };
				addRowMarkerData(table, header, {}, true);
				for (; i < response.rows.length; i++) {
					var rowOrig = response.rows[i];
					var bOpen = (rowOrig.dateEnd == null);
					var row = {};
					var cSecStart = rowOrig.dateStart;
					var cSecEnd = 0;


					row.dateStartStr = rowOrig.dateStartStr;
					if (bOpen) {
						row.dateEndStr = "";
						cSecEnd = Math.floor((new Date()).getTime() / 1000);
					}
					else {
						row.dateEndStr = rowOrig.dateEndStr;
						cSecEnd = rowOrig.dateEnd;
					}
					row.cDays = Math.floor((cSecEnd - cSecStart) / 60 / 60 / 24);
					row.userMarked = rowOrig.userMarked;
					row.userMarking = rowOrig.userMarking;
					row.seStart = parseFixedFloat(rowOrig.spentStart) + " / " + parseFixedFloat(rowOrig.estStart);
					if (bOpen) {
						var totalUser = totalByUser[row.userMarked];

						if (totalUser)
							row.seEnd = parseFixedFloat(totalUser.s) + " / " + parseFixedFloat(totalUser.e);
						else
							row.seEnd = "0 / 0";
					}
					else
						row.seEnd = parseFixedFloat(rowOrig.spentEnd) + " / " + parseFixedFloat(rowOrig.estEnd);
					row.nameMarker = rowOrig.nameMarker;
					var colors = {};
					if (!bOpen && (rowOrig.estEnd > rowOrig.estStart || rowOrig.spentEnd > rowOrig.spentStart))
						colors.seEnd = true;

					addRowMarkerData(table, row, colors, false);
				}
			} else {
			}
			container.show();
		});
}

function addRowMarkerData(table, rowData, colors, bHeader) {
	var row = $("<tr></tr>").addClass("agile-card-background").addClass("agile-card-statrow");
	if (bHeader)
		row.addClass("agile-card-background-header");
	var td = (bHeader ? '<th />' : '<td />');

	var i;
	for (i in rowData) {
		var data = rowData[i];
		var elem = $(td).text(typeof (data) == 'string' ? data : parseFixedFloat(data));
		if (colors[i])
			elem.css("background", "lightcoral");
		row.append(elem);
	}
	table.append(row);
}

function setChartData(rows, idBoard) {
	$("#reportLink").show();
	g_data = new google.visualization.DataTable();
	g_data.addColumn('datetime', 'Date');
	g_data.addColumn('number', 'Remaining');
	g_data.addColumn({ 'type': 'string', 'role': 'tooltip', 'p': { 'html': true } });
	g_data.addColumn('number', 'Spent');
	g_data.addColumn({ 'type': 'string', 'role': 'tooltip', 'p': { 'html': true } });
	g_data.addColumn({ type: 'string', role: 'annotation' });
	g_data.addColumn('number', 'Estimate');
	g_data.addColumn({ 'type': 'string', 'role': 'tooltip', 'p': { 'html': true } });

	var i = 0;
	var rowsNew = [];
	var spentTotal = 0;
	var estTotal = 0;
	var totalByUser = {};
	for (; i < rows.length; i++) {
		var row = rows[i];

		var date = new Date(row.date * 1000); //db is in seconds
		var spent = row.spent;
		var est = row.est;
		var idCard = row.idCard;
		var comment = row.comment;
		var card = row.name;
		var user = row.user;
		if (totalByUser[user] === undefined)
			totalByUser[user] = { s: 0, e: 0, data: [] };
		var totalsUser = totalByUser[user];
		totalsUser.s += spent;
		totalsUser.e += est;
		totalsUser.data.push(row); //for drilldown tooltip
		spentTotal += spent;
		estTotal += est;
		var remainTotalDisplay = parseFixedFloat(estTotal - spentTotal);
		var spentTotalDisplay = parseFixedFloat(spentTotal);
		var estTotalDisplay = parseFixedFloat(estTotal);
		var html = getHtmlBurndownTooltip(user, card, date, parseFixedFloat(spent), parseFixedFloat(est), spentTotalDisplay, estTotalDisplay, remainTotalDisplay, idCard, comment);
		var annotation = "";
		var iAnnotation = comment.indexOf("!");
		if (iAnnotation == 0 || comment.indexOf("] !") > 0) //needs to start with ! (] happens when Spent autoinserts markers like [+E] in the comment
			annotation = comment.slice(iAnnotation + 1);
		rowsNew.push([date, remainTotalDisplay, html, spentTotalDisplay, html, annotation, estTotalDisplay, html]);
	}
	g_dataUser = new google.visualization.DataTable();
	g_dataUser.addColumn('string', 'Who');
	g_dataUser.addColumn('number', 'S');
	//g_dataUser.addColumn({ 'type': 'string', 'role': 'tooltip', 'p': { 'html': true } });
	g_dataUser.addColumn('number', 'R');
	var rowsUser = [];
	var drilldowns = [];
	for (var keyUser in totalByUser) {
		var obj = totalByUser[keyUser];
		drilldowns.push([keyUser, obj.data, obj.data]);
		rowsUser.push([keyUser, parseFixedFloat(obj.s), parseFixedFloat(obj.e - obj.s)]);
	}
	addSumToRows(true, rowsUser, "E: ");
	g_dataUser.addRows(rowsUser);
	g_data.addRows(rowsNew);
	var elemProgress = document.getElementById("progress");
	if (rows.length == 0) {
		elemProgress.innerText = "No data for given board.";
	}
	else {
		g_chart = new google.visualization.LineChart(
			document.getElementById('visualization'));
		document.getElementById("progress").style.display = "none";
		var heightUser = ((2 + g_dataUser.getNumberOfRows()) * g_heightBarUser);
		var chartBottom = $("#visualizationBottom");
		chartBottom.css("height", "" + heightUser);
		g_chartUser = new google.visualization.BarChart(chartBottom[0]);
		var chartLocal = g_chartUser;
		g_chartUser.setAction({
			id: 'drilldown',				  // An id is mandatory for all actions.
			text: 'Drill-down',	   // The text displayed in the tooltip.
			action: function () {		   // When clicked, the following runs.
				handleDrilldownWindow(chartLocal, drilldowns, getHtmlBurndownTooltipByUser, "", 810, true);
				drawChartUser();
			}
		});
		g_chartUser.setAction({
			id: 'close-drilldown',				  // An id is mandatory for all actions.
			text: 'Close',	   // The text displayed in the tooltip.
			action: function () {		   // When clicked, the following runs.
				drawChartUser();
			}
		});

		if (g_bShowBoardMarkers) //REVIEW ZIG
			loadBoardMarkers(idBoard, totalByUser);
		drawChart();
		drawChartUser();
	}
}

function getHtmlBurndownTooltipByUser(rows, bReverse, colExclude) {
	var header = [{ name: "Date" }, { name: "Card" }, { name: "S" }, { name: "E" }, { name: "Comment", bExtend: true }, { name: COLUMNNAME_ETYPE }];
	function callbackRowData(row) {
		var rgRet = [];
		var date = new Date(row.date * 1000); //db is in seconds
		rgRet.push({ name: date.toDateString(), bNoTruncate: true });

		var urlCard = null;
		if (row.idCard.indexOf("https://") == 0)
			urlCard = row.idCard; //old-style card URLs. Could be on old historical data from a previous Spent version
		else
			urlCard = "https://trello.com/c/" + row.idCard;
		rgRet.push({ name: "<A target='_blank' href='" + urlCard + "'>" + strTruncate(row.name) + "</A>", bNoTruncate: true });
		rgRet.push({ name: parseFixedFloat(row.spent), bNoTruncate: true });
		rgRet.push({ name: parseFixedFloat(row.est), bNoTruncate: true });
		rgRet.push({ name: row.comment, bNoTruncate: false });
		rgRet.push({ name: nameFromEType(row.eType), bNoTruncate: true });
		if (row.comment.length > g_cchTruncateDefault)
			rgRet.title = row.comment;
		return rgRet;
	}

	return getHtmlBurndownTooltipFromRows(true, rows, bReverse, header, callbackRowData);
}

function getHtmlBurndownTooltip(user, card, date, spent, est, sTotal, eTotal, rTotal, idCard, comment) {
	var html = '<div class="agile_simpleTooltip">';
	html += '<div class="agile_tooltipTable" style="padding:10px 10px 10px 10px;">';
	var url = "";

	if (idCard.indexOf("https://") == 0)
		url = idCard; //old-style card URLs. Could be on old historical data from a previous Spent version
	else
		url = "https://trello.com/c/" + idCard;

	html += '<b><A target="_blank" href="' + url + '">' + card + '</A></b>';
	html += '<P>' + date.toDateString() + '</P>';
	html += '<P>user: ' + user + '</P>';
	html += '<P>S:' + spent + '  E:' + est + '</P>';
	if (comment != "")
		html += '<P>' + comment + '</P>';
	html += '<P></P>';
	html += '<P>running totals S:' + sTotal + ' E:' + eTotal + ' R:' + rTotal + '</P>';
	html += '<button class="closeBurndownTooltip">Close</button>';
	html += '</DIV></DIV>';
	return html;
}

function drawChart() {
	if (g_chart == null)
		return;
	g_chart.draw(g_data, {
		smoothLine: true,
		//chartArea: {top: 0, bottom:0},
		hAxis: {
			format: 'yyyy.MM.dd',
			slantedText: true,
			slantedTextAngle: "45",
			textStyle: { fontSize: "14" }
		},
		backgroundColor: {
			fill: "#E8EBEE"
		},
		width: "100%", height: "100%", title: "Burndown", legend: "bottom",
		titleTextStyle: { fontSize: "18", bold: true },
		tooltip: { isHtml: true, trigger: 'selection' },
		series: {
			0: { pointSize: 7, lineWidth: 2, color: 'green' },
			1: { pointSize: 7, lineWidth: 2, color: 'red' },
			2: { pointSize: 7, lineWidth: 2, color: 'blue' }
		}
	});
}


function drawChartUser() {
	if (g_chartUser == null)
		return;
	var style = {
		title: "By User",
		tooltip: { isHtml: false, trigger: 'selection' },
		titleTextStyle: { fontSize: "16", bold: true },
		chartArea: { left: 130, top: 40, height: g_dataUser.getNumberOfRows() * g_heightBarUser },
		height: "100%",
		vAxes: [{
			textStyle: {
				color: "#222",
				fontSize: 11
			}
		},
		{
			useFormatFromData: true
		}],
		series: {
			0: {
				color: 'red',
				errorBars: {
					errorType: "none"
				}
			},
			1: {
				color: 'green',
				errorBars: {
					errorType: "none"
				}
			}
		},
		booleanRole: "certainty",
		animation: {
			duration: 0
		},
		backgroundColor: {
			fill: "#E8EBEE"
		},
		legend: "none",
		hAxis: {
			viewWindowMode: 'pretty',
			useFormatFromData: false,
			formatOptions: {
				source: "inline",
				suffix: "h"
			},
			slantedText: false,
			minValue: 0,
			format: "0.#'h'",
			viewWindow: {
				max: null,
				min: null
			},
			logScale: false,
			gridlines: {
				count: 4
			},
			maxValue: null,
			textPosition: 'out',
			textStyle: {
				color: "#222",
				fontSize: 9
			}
		},
		isStacked: true,
		legendTextStyle: {
			color: "#222",
			fontSize: 9
		}
	};
	g_chartUser.draw(g_dataUser, style);
}


function getSQLReport(sql, values, callback) {
	getSQLReportShared(sql, values, callback, function onError(status) {
		showError(status);
	});
}