x = input("Enter the text : ")

count = 0
for i in x.lower():
    if i in set('aeiou'): #shoter format rather than using or function
        count = count+1     

print(f"The total number of vowels is {count}")