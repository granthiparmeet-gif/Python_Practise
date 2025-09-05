marks= [23,43,82.5,"kiran",2.39]
print(marks)
print(type(marks))
print(len(marks))

print(marks[3])
print(type(marks[3]))

marks[3]=46
print(marks)

print(marks[0:4])

marks.append("lavis")
print(marks)

print(marks.reverse())
marks.insert(3,"lokesa")
print(marks)


marks.pop(3)
print(marks)

marks.remove("lavis")
print(marks)