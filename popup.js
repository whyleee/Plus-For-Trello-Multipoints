var g_bLoaded = false; //needed because DOMContentLoaded gets called again when we modify the page


document.addEventListener('DOMContentLoaded', function () {
	if (g_bLoaded)
		return;
	g_bLoaded = true;
	loadBurndown();
});

function showError(strError) {
	logPlusError(strError);
	var progress = document.getElementById("progress");
	progress.innerText = strError;
	progress.style.display = "block";
}

function configBoardBurndownData() {
	sendExtensionMessage({ method: "openDB" },
			function (response) {
				if (response.status != "OK") {
					showError(response.status);
					return;
				}

			listAllBoards();
			});
}


function loadBurndown() {
	var topTitle = $("#topTitle");
	var body = $("body");

	topTitle.css("margin", "3px");
	$("#agile_boardSearch").focus();

	var reportLink = $("#reportLink");
	topTitle.text(document.title);
	var urlReport = chrome.extension.getURL("report.html")+"?weekStartRecent=true";
	reportLink.attr("href", urlReport);
	$("#reportLinkByUser").attr("href", urlReport + "&tab=1&popup=1").css("cursor", "-webkit-zoom-in");
	configBoardBurndownData();
}

function listAllBoards() {
	var sql = "SELECT b.idBoard, b.name, MAX(h.date) as maxDate FROM boards AS b JOIN history as H ON b.idBoard=h.idBoard GROUP BY h.idBoard ORDER BY maxDate DESC";
	var status = $("#progress");
	var header = $("#agile_divSearch_container");
	var urlBaseDashboard = chrome.extension.getURL("dashboard.html") + "?";
	var urlBaseReport = chrome.extension.getURL("report.html")+"?weekStartRecent=true&idBoard=";
	getSQLReport(sql, [], function (response) {
		if (response.status != "OK") {
			status.text(response.status);
			status.show();
			return;
		}
		
		var rows = response.rows;

		if (rows===undefined || rows.length == 0) {
			status.text("No boards with historical S/E reported by your team yet.");
			status.show();
			return;
		}
		var i = 0;
		var list = $("<div>");

		var mapBoards = {};
		for (; rows && i < rows.length; i++) {
			var item = $("<div tabindex=0>").addClass("agile_board_dashboardItem");
			var row = rows[i];
			var date = new Date(row.maxDate * 1000);
			var url = urlBaseDashboard + "idBoard=" + encodeURIComponent(row.idBoard) + "&board=" + encodeURIComponent(row.name);
			var a1 = $("<div class='agile_board_dashboardItem_name'>").text(row.name);
			var a2 = $("<span style='margin-right:5px'>");
			mapBoards[row.idBoard] = { div: item, se: a2, name:row.name };
			var imgDash = $("<img title='Dashboard'>").attr("src", chrome.extension.getURL("images/chart-sm.png")).addClass("agile_img_popup");
			var imgReport = $("<img title='Report'>").attr("src", chrome.extension.getURL("images/report-sm.png")).addClass("agile_img_popup");
			var urlReport = urlBaseReport + encodeURIComponent(row.idBoard);
			setPopupClickHandler(imgDash, url);
			setPopupClickHandler(imgReport, urlReport);
			item.attr("title", "Last reported: " + date.toLocaleDateString());
			setPopupClickHandler(item, "https://trello.com/b/" + row.idBoard); // must be in a function outside loop
			item.append(a1);
			item.append(a2);
			item.append(imgDash);
			item.append(imgReport);
			list.append(item);

		}
		list.insertAfter(header);
		var searchBox = $("#agile_boardSearch");
		searchBox.keypress(function (event) {
			var keycode = (event.keyCode ? event.keyCode : event.which);
			if (keycode == '13') {
				var elem = list.children(":visible").eq(0);
				if (elem.length == 1) {
					elem.click();
					return false;
				}
			}
		});

		searchBox.on('input', function () {
			var val = searchBox.val().toLowerCase();
			setTimeout(function () {
				var bodyElem = $("body");
				var hCur = bodyElem.height();
				for (var iBoards in mapBoards) {
					var item = mapBoards[iBoards];
					if (item.name.toLowerCase().indexOf(val) >= 0)
						item.div.show();
					else
						item.div.hide();
				}
				bodyElem.height(hCur); //resetting height is a hack to workarround a chrome bug that doesnt repaint scrollbars sometimes as height changes.
			},1);
		});

		setTimeout(function () {
			var sql2 = "SELECT b.idBoard, sum(h.spent) as spent, sum(h.est) as est FROM boards AS b JOIN history as H ON b.idBoard=h.idBoard GROUP BY h.idBoard";
			getSQLReport(sql2, [], function (response2) {
				if (response2.status != "OK") {
					status.text(response2.status);
					status.show();
					return;
				}

				var rows = response2.rows;
				var i = 0;
				for (; i < rows.length; i++) {
					var row = rows[i];
					var elemCur = mapBoards[row.idBoard];
					if (!elemCur)
						continue;
					elemCur.se.text(parseFixedFloat(row.spent) + " / " + parseFixedFloat(row.est));
				}
			});
		}, 10);
	});
}


function getSQLReport(sql, values, callback) {
	getSQLReportShared(sql, values, callback, function onError(status) {
		showError(status);
	});
}