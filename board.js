var g_minutesExpireBoardTotalCache = (60 * 24 * 7 * 2);	//after this many, board total cache is deleted.
var g_totalSpentAllBoards = 0;
var g_totalEstimateAllBoards = 0;

function updateBoardPageTotals() {
	g_totalSpentAllBoards = 0;
	g_totalEstimateAllBoards = 0;
	var boardContainers = $("#content").find(".js-open-board");
	var i = 0;
	for (; i < boardContainers.length; i++) {
		var elem = null;
		if (g_bNewTrello)
			elem = $(boardContainers[i]).find(".board-list-item-name")[0];
		else
			elem = $(boardContainers[i]).children(".item-name")[0];
		updateBoardUIElem($(elem));
	}
}

function getKeyForIdFromBoard(board) {
	return "idb:" + board;
}

function getKeySEFromBoard(board) {
	return "b:" + board;
}

function updateBoardUIElem(boardElem) {
	var board = boardElem.text();
	var parent = boardElem.parent();
	if (g_bNewTrello)
		parent = parent.parent();

	if (parent.hasClass("agile-card-listitem"))
		return;
	var key = getKeySEFromBoard(board);
	chrome.storage.local.get(key, function (obj) {
		var value = obj[key];
		var bHide = true;
		if (value !== undefined) {
			if (((new Date().getTime()) - value.t) / 1000 / 60 < g_minutesExpireBoardTotalCache) {
				addBadgesToBoardElem(boardElem, value);
				bHide = false;
			}
			else
				chrome.storage.local.remove(key);
		}
		if (g_bShowAllItems)
			bHide = false;

		if (bHide)
			parent.parent().hide();
		else
			parent.parent().show();
	});
}

function addBadgesToBoardElem(boardElem, value) {
	var container = boardElem.parent();
	var list = container.children("div." + BadgeFactory.spentBadgeClass());
	var spentBadge = null;
	if (list.size() == 0)
		spentBadge = BadgeFactory.makeSpentBadge();
	else
		spentBadge = list;

	spentBadge.contents().last()[0].textContent = value.s;
	g_totalSpentAllBoards += value.s;
	list = container.children("div." + BadgeFactory.estimateBadgeClass());
	var estimateBadge = null;
	if (list.size() == 0)
		estimateBadge = BadgeFactory.makeEstimateBadge();
	else
		estimateBadge = list;
	container.prepend(estimateBadge);
	container.prepend(spentBadge);
	estimateBadge.contents().last()[0].textContent = value.e;
	g_totalEstimateAllBoards += value.e;
}

function updateBoardSEStorage(boardCur, spent, estimate) {
	var date = new Date();
	var key = getKeySEFromBoard(boardCur);
	var value = { s: spent, e: estimate, t: date.getTime() }; //make the names small so it consumes less storage quota
	doSaveBoardValues(value, key);
}

function doSaveBoardValues(value, key) {
	//http://developer.chrome.com/extensions/storage.html
	var pair = {};
	pair[key] = value;
	chrome.storage.local.set(pair, function () { });
}

function detectRenamedBoard(idBoard, nameBoard) {
	var sql = "select name FROM boards WHERE idBoard=?";
	getSQLReport(sql, [idBoard],
		function (response) {
			if (response.rows === undefined || response.rows.length != 1 || response.rows[0].name === undefined || response.rows[0].name==nameBoard)
				return;
			var x = 1;
		});
}


var g_bNewTrello = true; //detect trello borderlands REVIEW zig: cleanup once all users move to this

function getCurrentBoard() {
	var boardNameContainerElem = $(".board-name");
	if (boardNameContainerElem.length == 0) {
		boardNameContainerElem = $(".board-header-btn-name");
		if (boardNameContainerElem.length == 0)
			return null;
		g_bNewTrello = true;
	} else {
		//g_bNewTrello = false; //note: for timing reasons we could end up here now, so its commented.
	}
	var boardNameElem = boardNameContainerElem.children(g_bNewTrello ? ".board-header-btn-text" : ".text");
	if (boardNameElem.length == 0)
		return null;
	var ret = boardNameElem.text().trim();
	if (ret == "")
		ret = null;
	return ret;
}